let requestsEnabled = true;

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
        .subscribe();
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

// Evento de envio do formulário
document.getElementById('requestForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    // Se os pedidos estão bloqueados pelo Admin, abre o modal de bloqueio
    if (!requestsEnabled) {
        document.getElementById('blockedModal').style.display = 'flex';
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
});
