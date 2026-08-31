let localQueue = [];
let knownRequestIds = new Set();
let isInitialLoad = true;
let requestsEnabled = false;

// Helper to parse device ID and IP from extra_info
function parseRequestMetadata(extraInfo) {
    if (!extraInfo) return { displayExtraInfo: '', deviceId: '', ip: '' };
    const marker = '__meta__';
    const idx = extraInfo.indexOf(marker);
    if (idx === -1) {
        return { displayExtraInfo: extraInfo, deviceId: '', ip: '' };
    }
    const displayExtraInfo = extraInfo.substring(0, idx).trim();
    const metaStr = extraInfo.substring(idx + marker.length);
    const parts = metaStr.split('||');
    let deviceId = '';
    let ip = '';
    parts.forEach(part => {
        if (part.startsWith('dev:')) {
            deviceId = part.substring(4);
        } else if (part.startsWith('ip:')) {
            ip = part.substring(3);
        }
    });
    return { displayExtraInfo, deviceId, ip };
}

// Generate unique identifier key for a request
function getRequestIdentifier(item) {
    if (!item) return '';
    const meta = parseRequestMetadata(item.extra_info);
    if (meta.deviceId) {
        return 'dev_' + meta.deviceId;
    }
    if (meta.ip && meta.ip !== 'unknown') {
        return 'ip_' + meta.ip;
    }
    return 'name_' + (item.name ? item.name.trim().toLowerCase() : '');
}

// Count completed songs for a specific requester identifier
function getTimesSung(item, allRequests) {
    const id = getRequestIdentifier(item);
    return allRequests.filter(r => 
        r.status === 'completed' && getRequestIdentifier(r) === id
    ).length;
}

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
        // 2. 'pending' segundo:
        //    - Prioriza quem tem zero vezes cantadas (sobe na fila)
        //    - Em caso de empate ou valores diferentes, ordena crescentemente por vezes cantadas
        //    - Em caso de empate de vezes cantadas, por ordem cronológica de pedido (criado primeiro fica em cima)
        // 3. 'completed' e 'cancelled' por último
        localQueue = data.sort((a, b) => {
            const statusOrder = { 'playing': 1, 'pending': 2, 'completed': 3, 'cancelled': 3 };
            const orderA = statusOrder[a.status] || 2;
            const orderB = statusOrder[b.status] || 2;

            if (orderA !== orderB) {
                return orderA - orderB;
            }

            if (a.status === 'pending' && b.status === 'pending') {
                const timesA = getTimesSung(a, data);
                const timesB = getTimesSung(b, data);

                if (timesA !== timesB) {
                    return timesA - timesB;
                }
            }

            return new Date(a.created_at) - new Date(b.created_at);
        });

        renderQueueTable();
        updateStats();
        updateRanking();
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
    const completedCount = localQueue.filter(item => item.status === 'completed').length;

    document.querySelector('#stat-pending .stat-value').textContent = pendingCount;
    document.querySelector('#stat-completed .stat-value').textContent = completedCount;
}

// Atualiza a seção de ranking dos cantores no painel lateral
function updateRanking() {
    const rankList = document.getElementById('rankList');
    if (!rankList) return;

    // Filtra pedidos válidos (não cancelados e com nome preenchido)
    const validRequests = localQueue.filter(item => item.status !== 'cancelled' && item.name && item.name.trim() !== '');

    // Agrupa e conta por nome (case-insensitive para agrupar, mas mantendo a capitalização original)
    const counts = {};
    const originalNames = {};

    validRequests.forEach(item => {
        const cleanName = item.name.trim();
        const lowerName = cleanName.toLowerCase();
        
        counts[lowerName] = (counts[lowerName] || 0) + 1;
        if (!originalNames[lowerName]) {
            originalNames[lowerName] = cleanName;
        }
    });

    // Converte para array e ordena decrescentemente
    const rankedUsers = Object.keys(counts).map(lowerName => {
        return {
            name: originalNames[lowerName],
            count: counts[lowerName]
        };
    }).sort((a, b) => b.count - a.count);

    if (rankedUsers.length === 0) {
        rankList.innerHTML = '<div class="rank-empty">Nenhum pedido realizado.</div>';
        return;
    }

    // Pega os top 5 cantores
    const topFive = rankedUsers.slice(0, 5);
    rankList.innerHTML = '';

    topFive.forEach((user, index) => {
        const position = index + 1;
        let rankClass = '';
        let medal = '';

        if (position === 1) {
            rankClass = 'rank-1st';
            medal = '🥇';
        } else if (position === 2) {
            rankClass = 'rank-2nd';
            medal = '🥈';
        } else if (position === 3) {
            rankClass = 'rank-3rd';
            medal = '🥉';
        } else {
            medal = `${position}º`;
        }

        const itemDiv = document.createElement('div');
        itemDiv.className = `rank-item ${rankClass}`;
        itemDiv.innerHTML = `
            <div class="rank-user">
                <span class="rank-position">${medal}</span>
                <span class="rank-name" title="${escapeHtml(user.name)}">${escapeHtml(user.name)}</span>
            </div>
            <span class="rank-count">${user.count} ${user.count === 1 ? 'música' : 'músicas'}</span>
        `;
        rankList.appendChild(itemDiv);
    });
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
        const parsedMeta = parseRequestMetadata(item.extra_info);
        const displayExtraInfo = parsedMeta.displayExtraInfo;
        return (
            item.name.toLowerCase().includes(searchVal) ||
            item.song.toLowerCase().includes(searchVal) ||
            (item.reference && item.reference.toLowerCase().includes(searchVal)) ||
            (displayExtraInfo && displayExtraInfo.toLowerCase().includes(searchVal))
        );
    });

    if (filteredQueue.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state">
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
        } else if (item.status === 'completed') {
            tr.className = 'row-completed';
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

        const requestTime = item.created_at ? new Date(item.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-';
        
        const parsedMeta = parseRequestMetadata(item.extra_info);
        const displayExtraInfo = parsedMeta.displayExtraInfo;
        
        let tooltipText = '';
        if (parsedMeta.ip && parsedMeta.ip !== 'unknown') {
            tooltipText += `IP: ${parsedMeta.ip}`;
        }
        if (parsedMeta.deviceId) {
            if (tooltipText) tooltipText += ' | ';
            tooltipText += `Dispositivo: ${parsedMeta.deviceId.substring(4, 12)}...`;
        }
        if (!tooltipText) tooltipText = 'Identificação legada/por nome';

        const singerCompletedCount = getTimesSung(item, localQueue);

        let badgeClass = 'count-zero';
        if (singerCompletedCount > 0) {
            badgeClass = singerCompletedCount >= 3 ? 'count-many' : 'count-has';
        }
        const singerBadgeHtml = `<span class="singer-count-badge ${badgeClass}">${singerCompletedCount}</span>`;

        tr.innerHTML = `
            <td><span title="${tooltipText}" style="cursor: help; border-bottom: 1px dotted rgba(255,255,255,0.2);">${escapeHtml(item.name)}</span></td>
            <td style="text-align: center;">${singerBadgeHtml}</td>
            <td>${escapeHtml(item.song)}</td>
            <td>${escapeHtml(item.reference || '-')}</td>
            <td>${escapeHtml(displayExtraInfo || '-')}</td>
            <td>${requestTime}</td>
            <td>${actionsHtml}</td>
        `;

        tbody.appendChild(tr);
    });
}

// Ação: Inicia uma música (coloca em status 'playing', abre busca no YouTube)
async function playSong(id, song, reference) {
    try {
        // Coloca esta música em status 'playing'
        const { error } = await supabaseClient
            .from('requests')
            .update({ status: 'playing' })
            .eq('id', id);

        if (error) throw error;

        // Atualiza a visualização local
        fetchQueue();
        
        // Abre busca do YouTube em nova aba
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

// ==========================================
// SISTEMA DE AUTENTICAÇÃO SIMPLES (FRONT-END)
// ==========================================
const ADMIN_PASSWORD_HASH = "3e621a4ad37f877e1799a985926587d9ddac419630b368fb90c39cbb7f197"; // hash de 'tocaadmin'
let isSyncInitialized = false;
let pollingIntervals = [];

// Função auxiliar para gerar hash SHA-256
async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Tentativa de login
async function tryLogin() {
    const passwordInput = document.getElementById('adminPassword').value;
    const errorMsg = document.getElementById('loginError');
    const hash = await sha256(passwordInput);

    if (hash === ADMIN_PASSWORD_HASH) {
        localStorage.setItem('admin_authenticated', 'true');
        showAdminPanel();
    } else {
        errorMsg.textContent = "Senha incorreta!";
        document.getElementById('adminPassword').value = '';
        document.getElementById('adminPassword').focus();
    }
}

// Logout do painel
function logout() {
    if (!confirm('Deseja realmente sair do painel?')) return;
    localStorage.removeItem('admin_authenticated');
    location.reload();
}

// Revela painel e inicializa a escuta/sincronização de dados
function showAdminPanel() {
    const loginOverlay = document.getElementById('loginOverlay');
    const adminLayout = document.getElementById('adminLayout');
    
    if (loginOverlay) loginOverlay.style.display = 'none';
    if (adminLayout) adminLayout.style.display = 'grid';
    
    if (!isSyncInitialized) {
        isSyncInitialized = true;
        setupSharing();
        fetchQueue();
        fetchRequestStatus();
        initRealtimeSync();

        // Polling fallback to ensure real-time updates even if Supabase Realtime is disabled or fails
        pollingIntervals.push(setInterval(fetchQueue, 3000));
        pollingIntervals.push(setInterval(fetchRequestStatus, 5000));
    }
}

// Inicializações ao carregar a página
document.addEventListener('DOMContentLoaded', () => {
    const isAuthenticated = localStorage.getItem('admin_authenticated') === 'true';
    if (isAuthenticated) {
        showAdminPanel();
    } else {
        const loginOverlay = document.getElementById('loginOverlay');
        const adminLayout = document.getElementById('adminLayout');
        const passwordInput = document.getElementById('adminPassword');
        
        if (loginOverlay) loginOverlay.style.display = 'flex';
        if (adminLayout) adminLayout.style.display = 'none';
        if (passwordInput) passwordInput.focus();
    }
});

