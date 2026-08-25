let requestsEnabled = false;

// Inicializa a escuta de mudanças de configuração em tempo real no Supabase
async function initSettingsSync() {
    // 1. Busca o status inicial
    const { data, error } = await supabaseClient
        .from('settings')
        .select('requests_enabled')
        .eq('id', 1)
        .single();

    if (!error && data) {
        requestsEnabled = data.requests_enabled;
        updateRequestsUI();
    } else {
        console.error("Erro ao buscar configurações iniciais:", error);
    }

    // 2. Escuta alterações em tempo real na tabela 'settings'
    supabaseClient
        .channel('settings-changes')
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'settings', filter: 'id=eq.1' },
            (payload) => {
                if (payload.new) {
                    requestsEnabled = payload.new.requests_enabled;
                    updateRequestsUI();
                }
            }
        )
        .subscribe((status, err) => {
            console.log('Realtime Client Settings Status:', status);
            if (err) console.error('Realtime Client Settings Error:', err);
        });
}

// Atualiza o estado visual do botão de envio baseado no bloqueio de pedidos
function updateRequestsUI() {
    const submitBtn = document.getElementById('submitBtn');
    if (requestsEnabled) {
        submitBtn.disabled = false;
        submitBtn.querySelector('.btn-text').textContent = 'Enviar Pedido';
        submitBtn.style.opacity = '1';
        submitBtn.style.cursor = 'pointer';
    } else {
        submitBtn.disabled = false; // Permite clicar para disparar o modal explicativo
        submitBtn.querySelector('.btn-text').textContent = 'Pedidos Bloqueados 🔒';
        submitBtn.style.opacity = '0.7';
    }
}

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutos em milissegundos

// Retorna o tempo restante de cooldown em milissegundos (ou 0 se não estiver em cooldown)
function getRemainingCooldownTime() {
    const lastRequestTime = localStorage.getItem('lastRequestTime');
    if (!lastRequestTime) return 0;
    
    const elapsed = Date.now() - parseInt(lastRequestTime, 10);
    const remaining = COOLDOWN_MS - elapsed;
    return remaining > 0 ? remaining : 0;
}

function closeCooldownModal() {
    document.getElementById('cooldownModal').style.display = 'none';
}

// Evento de envio do formulário
document.getElementById('requestForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    // Se os pedidos estão bloqueados pelo Admin, abre o modal de bloqueio
    if (!requestsEnabled) {
        document.getElementById('blockedModal').style.display = 'flex';
        return;
    }

    // Verifica se o dispositivo está no período de cooldown de 5 minutos
    const remainingTime = getRemainingCooldownTime();
    if (remainingTime > 0) {
        const minutes = Math.floor(remainingTime / 60000);
        const seconds = Math.floor((remainingTime % 60000) / 1000);
        const formattedTime = `${minutes}m ${seconds}s`;
        
        document.getElementById('cooldownMessage').textContent = `Você já enviou um pedido recentemente. Para evitar sobrecarregar a fila, por favor aguarde mais ${formattedTime} antes de pedir outra música!`;
        document.getElementById('cooldownModal').style.display = 'flex';
        return;
    }

    const submitBtn = document.getElementById('submitBtn');
    const originalText = submitBtn.innerHTML;
    
    // Altera o estado do botão para enviando
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="btn-text">Enviando...</span>';

    const name = document.getElementById('name').value.trim();
    const song = document.getElementById('song').value.trim();
    const reference = document.getElementById('reference').value.trim();
    const extra_info = document.getElementById('extra_info').value.trim();

    try {
        // Envia o pedido diretamente para a tabela do Supabase
        const { error } = await supabaseClient
            .from('requests')
            .insert([
                {
                    name: name,
                    song: song,
                    reference: reference,
                    extra_info: extra_info,
                    status: 'pending'
                }
            ]);

        if (error) throw error;

        // Salva o timestamp do pedido no localStorage para o cooldown
        localStorage.setItem('lastRequestTime', Date.now().toString());

        // Abre o modal de sucesso
        document.getElementById('successModal').style.display = 'flex';
        
        // Limpa os campos do formulário mantendo apenas o Nome
        document.getElementById('song').value = '';
        document.getElementById('reference').value = '';
        document.getElementById('extra_info').value = '';
    } catch (error) {
        console.error("Erro ao enviar pedido para o Supabase:", error);
        alert("Erro ao enviar pedido: " + (error.message || error));
    } finally {
        // Restaura o estado do botão
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
        updateRequestsUI();
    }
});

function closeModal() {
    document.getElementById('successModal').style.display = 'none';
    document.getElementById('song').focus();
}

function closeBlockedModal() {
    document.getElementById('blockedModal').style.display = 'none';
}

// Inicializa a sincronização ao carregar a página
document.addEventListener('DOMContentLoaded', () => {
    initSettingsSync();

    // Polling fallback to ensure settings updates even if Supabase Realtime is disabled or fails
    setInterval(async () => {
        try {
            const { data, error } = await supabaseClient
                .from('settings')
                .select('requests_enabled')
                .eq('id', 1)
                .single();

            if (!error && data) {
                requestsEnabled = data.requests_enabled;
                updateRequestsUI();
            }
        } catch (err) {
            console.error("Erro no polling de configurações:", err);
        }
    }, 5000);
});
