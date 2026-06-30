/* =========================================================
   FULLGAS B2B — autenticação (index.html)
   ========================================================= */
(function () {
  'use strict';

  var tabLogin = document.getElementById('tab-login');
  var tabCad = document.getElementById('tab-cad');
  var formLogin = document.getElementById('form-login');
  var formCad = document.getElementById('form-cad');
  var msg = document.getElementById('auth-msg');

  // se já existe sessão, vai direto para o portal
  if (FG.session()) { location.href = 'portal.html'; return; }

  function showMsg(texto, tipo) {
    msg.textContent = texto || '';
    msg.className = 'auth-msg' + (texto ? ' ' + (tipo || 'err') : '');
  }

  function switchTab(qual) {
    var login = qual === 'login';
    tabLogin.classList.toggle('on', login);
    tabCad.classList.toggle('on', !login);
    formLogin.classList.toggle('hidden', !login);
    formCad.classList.toggle('hidden', login);
    showMsg('');
  }

  tabLogin.addEventListener('click', function () { switchTab('login'); });
  tabCad.addEventListener('click', function () { switchTab('cad'); });

  /* ---------- login ---------- */
  async function doLogin() {
    var email = document.getElementById('lg-email').value.trim();
    var senha = document.getElementById('lg-senha').value;
    if (!email || !senha) { showMsg('Informe e-mail e senha.'); return; }
    var r = await FG.login(email, senha);
    if (!r.ok) { showMsg(r.msg); return; }
    location.href = 'portal.html';
  }
  document.getElementById('btn-login').addEventListener('click', doLogin);
  formLogin.addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });

  /* ---------- cadastro ---------- */
  async function doRegister() {
    var dados = {
      nome: document.getElementById('cd-nome').value.trim(),
      empresa: document.getElementById('cd-empresa').value.trim(),
      email: document.getElementById('cd-email').value.trim(),
      senha: document.getElementById('cd-senha').value
    };
    if (!dados.nome || !dados.empresa || !dados.email || !dados.senha) {
      showMsg('Preencha todos os campos.'); return;
    }
    if (dados.senha.length < 6) { showMsg('A senha precisa de ao menos 6 caracteres.'); return; }
    if (!/^\S+@\S+\.\S+$/.test(dados.email)) { showMsg('E-mail inválido.'); return; }

    var r = await FG.register(dados);
    if (!r.ok) { showMsg(r.msg); return; }
    switchTab('login');
    showMsg('Cadastro enviado! Assim que um administrador aprovar, você poderá entrar.', 'ok');
    document.getElementById('lg-email').value = dados.email;
  }
  document.getElementById('btn-cad').addEventListener('click', doRegister);
  formCad.addEventListener('keydown', function (e) { if (e.key === 'Enter') doRegister(); });
})();
