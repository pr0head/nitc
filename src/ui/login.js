// Login screen: black, logo, two fields, one button. Minimal by intent.
// On submit it exchanges email+password for an intel bearer, then hands control
// back to the boot flow via onSuccess.
import { login } from '../api/auth.js';
import { session } from '../state/session.js';
import logoUrl from '../assets/logo.jpg';
import { APK_URL, androidBrowser } from './android.js';

const ERRORS = {
  invalid_credentials: 'Неверный email или пароль.',
  invalid_input: 'Проверьте email и пароль.',
  rate_limited: 'Слишком много попыток. Повторите позже.',
  origin_denied: 'Сервер отклонил запрос. Попробуйте позже.',
  network: 'Сеть недоступна. Проверьте соединение.',
};

export function showLogin(root, onSuccess) {
  root.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'login';
  el.innerHTML = `
    <form class="login__card" autocomplete="on" novalidate>
      <img class="login__logo" src="${logoUrl}" alt="NITC" width="88" height="88" />
      <h1 class="login__title">NITC</h1>
      <p class="login__sub">Интел-карта Netgress — карта, а не сама игра.</p>
      <p class="login__hint">
        Вход под аккаунтом игры. Нет аккаунта? Установите
        <a href="https://netgress.ru" target="_blank" rel="noopener">Netgress</a>,
        зарегистрируйтесь в игре и войдите здесь с теми же email и паролем.
      </p>
      <label class="login__field">
        <span>Email</span>
        <input name="email" type="email" inputmode="email" autocomplete="username" required />
      </label>
      <label class="login__field">
        <span>Пароль</span>
        <input name="password" type="password" autocomplete="current-password" required />
      </label>
      <button class="login__btn" type="submit">Войти</button>
      <p class="login__err" hidden></p>
      ${androidBrowser ? `
      <div class="login__apk">
        <b>NITC для Android</b>
        <span>Эта же карта отдельным приложением, на весь экран. Вход из браузера
          в приложение не переносится — удобнее поставить его сразу.
          На странице релиза скачайте файл <i>.apk</i>.</span>
        <a class="login__apk-btn" href="${APK_URL}" target="_blank" rel="noopener">Скачать приложение карты</a>
      </div>` : ''}
    </form>`;
  root.appendChild(el);

  const form = el.querySelector('form');
  const email = form.email;
  const pass = form.password;
  const btn = form.querySelector('.login__btn');
  const err = el.querySelector('.login__err');
  email.value = session.email;
  // on an Android browser the keyboard would cover the hints
  if (!androidBrowser) (email.value ? pass : email).focus();

  const fail = (msg) => { err.textContent = msg; err.hidden = false; };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (!email.value || !pass.value) return fail('Заполните оба поля.');
    btn.disabled = true;
    btn.textContent = 'Проверяем…';
    try {
      await login(email.value.trim(), pass.value);
      onSuccess();
    } catch (ex) {
      fail(ERRORS[ex?.code] || 'Не удалось войти. Попробуйте ещё раз.');
      btn.disabled = false;
      btn.textContent = 'Войти';
      pass.select();
    }
  });
}
