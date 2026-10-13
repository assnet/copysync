const API_URL = 'https://api.rediirect.com/api/tokens/save';

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('tokenForm');
  const statusMessage = document.getElementById('statusMessage');
  const loading = document.getElementById('loading');
  const submitBtn = document.getElementById('submitBtn');

  // Verifica se está logado no ML
  await checkMLLogin();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveTokens();
  });

  async function checkMLLogin() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab.url.includes('mercadolivre.com.br')) {
        showStatus('Abra uma página do Mercado Livre', 'warning');
        return;
      }

      const cookies = await chrome.cookies.getAll({ domain: '.mercadolivre.com.br' });
      const ssid = cookies.find(c => c.name === 'ssid');
      
      if (ssid && ssid.value) {
        showStatus('✅ Token detectado! Preencha os dados abaixo', 'success');
      } else {
        showStatus('⚠️ Faça login no Mercado Livre primeiro', 'warning');
      }
    } catch (error) {
      console.error('Erro ao verificar login:', error);
      showStatus('Erro ao verificar login no ML', 'error');
    }
  }

  async function saveTokens() {
    try {
      loading.classList.add('active');
      submitBtn.disabled = true;
      form.style.display = 'none';

      // Captura cookies do ML
      const cookies = await chrome.cookies.getAll({ domain: '.mercadolivre.com.br' });
      const ssid = cookies.find(c => c.name === 'ssid');
      const orgnickp = cookies.find(c => c.name === 'orgnickp');

      if (!ssid || !ssid.value) {
        throw new Error('Token não encontrado. Faça login no Mercado Livre.');
      }

      // Captura CSRF token da página
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const csrfToken = await getCsrfToken(tab.id);

      if (!csrfToken) {
        throw new Error('CSRF token não encontrado. Recarregue a página do ML.');
      }

      // Dados do formulário
      const userEmail = document.getElementById('userEmail').value;
      const etiqueta = document.getElementById('etiqueta').value;

      // Envia para API
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: null,
          user_email: userEmail,
          etiqueta: etiqueta,
          ssid: ssid.value,
          csrf_token: csrfToken
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao salvar tokens');
      }

      // Salva dados localmente para renovação automática
      await chrome.storage.local.set({
        userEmail: userEmail,
        etiqueta: etiqueta,
        lastUpdate: new Date().toISOString()
      });

      showStatus('✅ Tokens salvos com sucesso!', 'success');
      
      // Inicia renovação automática
      chrome.runtime.sendMessage({ action: 'startAutoRenewal' });

      setTimeout(() => {
        window.close();
      }, 2000);

    } catch (error) {
      console.error('Erro:', error);
      showStatus('❌ ' + error.message, 'error');
      form.style.display = 'block';
    } finally {
      loading.classList.remove('active');
      submitBtn.disabled = false;
    }
  }

async function getCsrfToken(tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
          const meta = document.querySelector('meta[name="csrf-token"]');
          if (meta && meta.content) {
            return meta.content;
          }
          return null;
        }
      });
      
      const token = results && results[0] && results[0].result;
      console.log('CSRF Token capturado:', token);
      return token;
    } catch (error) {
      console.error('Erro ao capturar CSRF:', error);
      return null;
   
 }
  }
  function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = 'status ' + type;
  }
});
