let localQueue = [];
let knownRequestIds = new Set();
let isInitialLoad = true;
let requestsEnabled = false;

// Web Audio API Synthesizer Chime para novos pedidos
function playNotificationSound() {
    if (!document.getElementById('audioToggle').checked) return;
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Nota 1: E5
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(659.25, audioCtx.currentTime); 
        gain1.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.start();
        osc1.stop(audioCtx.currentTime + 0.4);
        
        // Nota 2: A5 (inicia um pouco depois)
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(880.00, audioCtx.currentTime + 0.12); 
        gain2.gain.setValueAtTime(0.1, audioCtx.currentTime + 0.12);
        gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.55);
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.start(audioCtx.currentTime + 0.12);
        osc2.stop(audioCtx.currentTime + 0.55);
    } catch (e) {
        console.warn("Não foi possível tocar o som de notificação (pode exigir interação prévia do usuário):", e);
    }
}

let isFetchingQueue = false;
// Busca a fila de pedidos do Supabase
async function fetchQueue() {
    if (isFetchingQueue) return;
    isFetchingQueue = true;
    try {
        const { data, error } = await supabaseClient
            .from('requests')
            .select('*');

        if (error) throw error;

        let hasNewRequest = false;
        
        // Verifica se há novos pedidos pendentes para tocar o sino
        data.forEach(item => {
            if (item.status === 'pending' && !knownRequestIds.has(item.id)) {
                knownRequestIds.add(item.id);
                if (!isInitialLoad) {
                    hasNewRequest = true;
                }
            }
        });

        // Inicializa IDs conhecidos no primeiro carregamento
        if (isInitialLoad) {
            data.forEach(item => knownRequestIds.add(item.id));
            isInitialLoad = false;
        }

        if (hasNewRequest) {
            playNotificationSound();
        }

        // Ordena os dados localmente
        // 1. 'playing' primeiro
        // 2. 'pending' segundo (por ordem de envio / data de criação)
        // 3. 'completed' e 'cancelled' por último
        localQueue = data.sort((a, b) => {
            const statusOrder = { 'playing': 1, 'pending': 2, 'completed': 3, 'cancelled': 3 };
            const orderA = statusOrder[a.status] || 2;
            const orderB = statusOrder[b.status] || 2;

            if (orderA !== orderB) {
                return orderA - orderB;
            }
            return new Date(a.created_at) - new Date(b.created_at);
        });

        renderQueueTable();
        updateStats();
    } catch (error) {
        console.error('Erro ao buscar a fila do Supabase:', error);
    } finally {
        isFetchingQueue = false;
    }
}

// Inicializa a sincronização em tempo real do banco de dados
function initRealtimeSync() {
    // 1. Escuta mudanças na fila de músicas ('requests')
    supabaseClient
        .channel('requests-db-changes')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'requests' },
            () => {
                fetchQueue();
            }
        )
        .subscribe((status, err) => {
            console.log('Realtime Requests Status:', status);
            if (err) console.error('Realtime Requests Error:', err);
        });

    // 2. Escuta mudanças nas configurações globais ('settings')
    supabaseClient
        .channel('settings-db-changes')
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'settings', filter: 'id=eq.1' },
            (payload) => {
                if (payload.new) {
                    requestsEnabled = payload.new.requests_enabled;
                    updateRequestStatusUI(requestsEnabled);
                }
            }
        )
        .subscribe((status, err) => {
            console.log('Realtime Settings Status:', status);
            if (err) console.error('Realtime Settings Error:', err);
        });
}

let isFetchingStatus = false;
// Busca o status inicial do bloqueador de pedidos
async function fetchRequestStatus() {
    if (isFetchingStatus) return;
    isFetchingStatus = true;
    try {
        const { data, error } = await supabaseClient
            .from('settings')
            .select('requests_enabled')
            .eq('id', 1)
            .single();

        if (error) throw error;
        if (data) {
            requestsEnabled = data.requests_enabled;
            updateRequestStatusUI(requestsEnabled);
        }
    } catch (error) {
        console.error('Erro ao buscar status dos pedidos:', error);
    } finally {
        isFetchingStatus = false;
    }
}

// Habilita ou desabilita pedidos na tabela 'settings'
async function toggleRequests(enabled) {
    try {
        const { error } = await supabaseClient
            .from('settings')
            .update({ requests_enabled: enabled })
            .eq('id', 1);

        if (error) throw error;
        requestsEnabled = enabled;
        updateRequestStatusUI(enabled);
    } catch (error) {
        console.error('Erro ao alterar status dos pedidos no Supabase:', error);
    }
}

// Atualiza o estado visual das abas de controle de pedidos
function updateRequestStatusUI(enabled) {
    const btnAllow = document.getElementById('btnAllowRequests');
    const btnBlock = document.getElementById('btnBlockRequests');
    if (!btnAllow || !btnBlock) return;

    if (enabled) {
        btnAllow.style.background = 'rgba(46, 224, 14, 0.15)';
        btnAllow.style.borderColor = '#2ee00e';
        btnAllow.style.color = '#fff';
        btnAllow.style.boxShadow = '0 0 15px rgba(46, 224, 14, 0.3)';

        btnBlock.style.background = 'rgba(255, 255, 255, 0.02)';
        btnBlock.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        btnBlock.style.color = 'var(--text-muted)';
        btnBlock.style.boxShadow = 'none';
    } else {
        btnAllow.style.background = 'rgba(255, 255, 255, 0.02)';
        btnAllow.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        btnAllow.style.color = 'var(--text-muted)';
        btnAllow.style.boxShadow = 'none';

        btnBlock.style.background = 'rgba(255, 60, 60, 0.15)';
        btnBlock.style.borderColor = 'var(--accent-red)';
        btnBlock.style.color = '#fff';
        btnBlock.style.boxShadow = '0 0 15px rgba(255, 60, 60, 0.3)';
    }
}

// Atualiza cartões de estatísticas no painel lateral
function updateStats() {
    const pendingCount = localQueue.filter(item => item.status === 'pending').length;
    const playingCount = localQueue.filter(item => item.status === 'playing').length;
    const completedCount = localQueue.filter(item => item.status === 'completed').length;

    document.querySelector('#stat-pending .stat-value').textContent = pendingCount;
    document.querySelector('#stat-playing .stat-value').textContent = playingCount;
    document.querySelector('#stat-completed .stat-value').textContent = completedCount;
}

// Filtra a fila utilizando a barra de pesquisa
function filterQueue() {
    renderQueueTable();
}

// Renderiza as linhas dinamicamente na tabela
function renderQueueTable() {
    const tbody = document.getElementById('queueTableBody');
    const searchVal = document.getElementById('searchBar').value.toLowerCase().trim();
    
    const filteredQueue = localQueue.filter(item => {
        if (!searchVal) return true;
        return (
            item.name.toLowerCase().includes(searchVal) ||
            item.song.toLowerCase().includes(searchVal) ||
            (item.reference && item.reference.toLowerCase().includes(searchVal)) ||
            (item.extra_info && item.extra_info.toLowerCase().includes(searchVal))
        );
    });

    if (filteredQueue.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-state">
                    ${localQueue.length === 0 ? 'Nenhuma música na fila. Aguardando pedidos...' : 'Nenhum pedido correspondente à pesquisa.'}
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = '';

    filteredQueue.forEach(item => {
        const tr = document.createElement('tr');
        if (item.status === 'playing') {
            tr.className = 'row-playing';
        }

        let actionsHtml = '';
        if (item.status === 'pending') {
            actionsHtml = `
                <div class="actions-cell">
                    <button onclick="playSong(${item.id}, '${escapeQuote(item.song)}', '${escapeQuote(item.reference || '')}')" class="btn-action btn-play" title="Tocar música e abrir busca do YouTube">
                        <span>▶ Tocar</span>
                    </button>
                    <button onclick="updateStatus(${item.id}, 'completed')" class="btn-action btn-done" title="Marcar como cantada">
                        <span>✓ Concluir</span>
                    </button>
                    <button onclick="updateStatus(${item.id}, 'cancelled')" class="btn-action btn-cancel" title="Cancelar pedido">
                        <span>✕ Cancelar</span>
                    </button>
                </div>
            `;
        } else if (item.status === 'playing') {
            actionsHtml = `
                <div class="actions-cell">
                    <span class="badge-status badge-playing">● Tocando</span>
                    <button onclick="updateStatus(${item.id}, 'completed')" class="btn-action btn-play" style="background-color: var(--primary); color: white;" title="Concluir apresentação">
                        <span>✓ Concluir</span>
                    </button>
                    <button onclick="updateStatus(${item.id}, 'cancelled')" class="btn-action btn-cancel" title="Cancelar apresentação">
                        <span>✕ Cancelar</span>
                    </button>
                </div>
            `;
        } else {
            const badgeClass = item.status === 'completed' ? 'badge-completed' : 'badge-cancelled';
            const statusLabel = item.status === 'completed' ? 'Cantada' : 'Cancelada';
            actionsHtml = `
                <div class="actions-cell">
                    <span class="badge-status ${badgeClass}">${statusLabel}</span>
                    <button onclick="deleteRequest(${item.id})" class="btn-action btn-delete" title="Excluir do histórico">
                        <span>Remover</span>
                    </button>
                </div>
            `;
        }

        tr.innerHTML = `
            <td>${escapeHtml(item.name)}</td>
            <td>${escapeHtml(item.song)}</td>
            <td>${escapeHtml(item.reference || '-')}</td>
            <td>${escapeHtml(item.extra_info || '-')}</td>
            <td>${actionsHtml}</td>
        `;

        tbody.appendChild(tr);
    });
}

// Ação: Inicia uma música (coloca em status 'playing', altera as outras 'playing' para 'completed', abre busca no YouTube)
async function playSong(id, song, reference) {
    try {
        // 1. Atualiza qualquer música que esteja tocando agora para "concluída"
        await supabaseClient
            .from('requests')
            .update({ status: 'completed' })
            .eq('status', 'playing');

        // 2. Coloca esta música em status 'playing'
        const { error } = await supabaseClient
            .from('requests')
            .update({ status: 'playing' })
            .eq('id', id);

        if (error) throw error;

        // Atualiza a visualização local
        fetchQueue();
        
        // 3. Abre busca do YouTube em nova aba
        const searchQuery = `karaoke ${song} ${reference}`.trim();
        const youtubeUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`;
        window.open(youtubeUrl, '_blank');
    } catch (error) {
        console.error('Erro ao tocar música no Supabase:', error);
    }
}

// Ação: Atualiza status diretamente
async function updateStatus(id, newStatus) {
    try {
        const { error } = await supabaseClient
            .from('requests')
            .update({ status: newStatus })
            .eq('id', id);

        if (error) throw error;
        fetchQueue();
    } catch (error) {
        console.error('Erro ao atualizar status no Supabase:', error);
    }
}

// Ação: Deleta pedido da fila
async function deleteRequest(id) {
    try {
        const { error } = await supabaseClient
            .from('requests')
            .delete()
            .eq('id', id);

        if (error) throw error;
        fetchQueue();
    } catch (error) {
        console.error('Erro ao excluir pedido no Supabase:', error);
    }
}

// Ação: Limpa histórico (deleta concluídos e cancelados)
async function clearHistory() {
    if (!confirm('Deseja limpar todos os pedidos concluídos e cancelados do histórico?')) return;
    try {
        const { error } = await supabaseClient
            .from('requests')
            .delete()
            .in('status', ['completed', 'cancelled']);

        if (error) throw error;
        fetchQueue();
    } catch (error) {
        console.error('Erro ao limpar histórico no Supabase:', error);
    }
}

// Ação: Limpa a fila (deleta pendentes e tocando)
async function clearQueue() {
    if (!confirm('Deseja limpar todos os pedidos ativos (pendentes e tocando) da fila?')) return;
    try {
        const { error } = await supabaseClient
            .from('requests')
            .delete()
            .in('status', ['pending', 'playing']);

        if (error) throw error;
        fetchQueue();
    } catch (error) {
        console.error('Erro ao limpar fila de ativos no Supabase:', error);
    }
}

// Configuração do compartilhamento do Link do Cliente e QR Code
function setupSharing() {
    const currentUrl = window.location.href;
    // Pega o caminho atual e substitui admin.html por index.html
    const clientUrl = currentUrl.substring(0, currentUrl.lastIndexOf('/')) + '/index.html';
    
    const urlInput = document.getElementById('clientUrlVal');
    const qrImg = document.getElementById('clientQrCode');

    if (urlInput) {
        urlInput.value = clientUrl;
    }
    if (qrImg) {
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=${encodeURIComponent(clientUrl)}`;
    }
}

function copyClientUrl() {
    const urlVal = document.getElementById('clientUrlVal');
    if (!urlVal) return;
    
    urlVal.select();
    urlVal.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(urlVal.value)
        .then(() => {
            const copyBtn = document.querySelector('.btn-copy');
            const originalText = copyBtn.textContent;
            copyBtn.textContent = '✓';
            setTimeout(() => {
                copyBtn.textContent = originalText;
            }, 1500);
        })
        .catch(err => console.error('Erro ao copiar link:', err));
}

// Helpers
function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.toString().replace(/[&<>"']/g, function(m) { return map[m]; });
}

function escapeQuote(text) {
    if (!text) return '';
    return text.replace(/'/g, "\\'");
}

// Inicializações ao carregar a página
document.addEventListener('DOMContentLoaded', () => {
    setupSharing();
    fetchQueue();
    fetchRequestStatus();
    initRealtimeSync();

    // Polling fallback to ensure real-time updates even if Supabase Realtime is disabled or fails
    setInterval(fetchQueue, 3000);
    setInterval(fetchRequestStatus, 5000);
});
