// Script que roda nas páginas do Mercado Livre
// Ajuda a capturar informações da página

// Detecta se usuário está logado
function checkIfLoggedIn() {
  const userMenu = document.querySelector('[data-testid="user-menu"]');
  const isLogged = !!userMenu || document.cookie.includes('ssid=');
  
  if (isLogged) {
    console.log('✅ Usuário logado no Mercado Livre');
  }
  
  return isLogged;
}

// Captura CSRF token da página
function getCsrfToken() {
  // Tenta pegar do meta tag
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (meta) return meta.content;
  
  // Tenta pegar de variável global
  if (window.__PRELOADED_STATE__) {
    const state = window.__PRELOADED_STATE__;
    if (state.csrf) return state.csrf;
  }
  
  return null;
}

// Listener para mensagens da extensão
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkLogin') {
    sendResponse({ isLoggedIn: checkIfLoggedIn() });
  }
  
  if (request.action === 'getCsrf') {
    sendResponse({ csrfToken: getCsrfToken() });
  }
});

// Executa quando a página carrega
window.addEventListener('load', () => {
  checkIfLoggedIn();
});

console.log('Afiliado Inteligente - Content Script carregado');
