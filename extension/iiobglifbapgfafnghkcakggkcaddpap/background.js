const API_URL = 'https://api.copysync.com/api/tokens/save';

// Configura alarme para renovação automática (a cada 30 minutos)
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('autoRenewal', { periodInMinutes: 30 });
  console.log('Extensão instalada! Auto-renovação configurada.');
});

// Listener para renovação automática
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'autoRenewal') {
    renewTokens();
  }
});

// Listener para mensagens do popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startAutoRenewal') {
    console.log('Renovação automática iniciada pelo usuário');
    renewTokens();
  }
});

// Função principal de renovação
async function renewTokens() {
  try {
    console.log('Iniciando renovação automática de tokens...');
    
    // Busca dados salvos localmente
    const storage = await chrome.storage.local.get(['userId', 'userEmail', 'etiqueta']);
    
    if (!storage.userId || !storage.etiqueta) {
      console.log('Dados de usuário não encontrados. Renovação cancelada.');
      return;
    }

    // Captura cookies atualizados
    const cookies = await chrome.cookies.getAll({ domain: '.mercadolivre.com.br' });
    const ssid = cookies.find(c => c.name === 'ssid');
    
    if (!ssid || !ssid.value) {
      console.log('Usuário não está logado no ML. Renovação cancelada.');
      return;
    }

    // Tenta capturar CSRF token de alguma aba aberta do ML
    const tabs = await chrome.tabs.query({ url: 'https://*.mercadolivre.com.br/*' });
    let csrfToken = null;

    if (tabs.length > 0) {
      csrfToken = await getCsrfFromTab(tabs[0].id);
    }

    if (!csrfToken) {
      console.log('CSRF token não encontrado. Usuário precisa abrir o ML.');
      return;
    }

    // Envia tokens atualizados para a API
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: storage.userId,
        user_email: storage.userEmail,
        etiqueta: storage.etiqueta,
        ssid: ssid.value,
        csrf_token: csrfToken
      })
    });

    if (response.ok) {
      console.log('✅ Tokens renovados com sucesso!');
      await chrome.storage.local.set({ lastUpdate: new Date().toISOString() });
    } else {
      console.error('❌ Erro ao renovar tokens:', await response.text());
    }

  } catch (error) {
    console.error('Erro na renovação automática:', error);
  }
}

// Captura CSRF token de uma aba específica
async function getCsrfFromTab(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta) return meta.content;
        
        if (window.__PRELOADED_STATE__ && window.__PRELOADED_STATE__.csrf) {
          return window.__PRELOADED_STATE__.csrf;
        }
        
        return null;
      }
    });
    
    return results[0]?.result;
  } catch (error) {
    console.error('Erro ao capturar CSRF:', error);
    return null;
  }
}
