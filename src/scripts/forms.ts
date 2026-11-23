/** Inline validation: runs on blur, re-checks on input once a field has shown an error, and on submit. */

type Rule = (value: string, field: HTMLInputElement | HTMLTextAreaElement) => string | null;

const digits = (v: string) => v.replace(/\D/g, '');

export const rules: Record<string, Rule> = {
  name: (v) => (v.trim().length < 2 ? 'Enter your name so we know who to reply to.' : null),
  email: (v) =>
    !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? 'Enter an email address like name@example.com.' : null,
  phone: (v) => {
    const d = digits(v);
    if (d.length === 11 && d.startsWith('1')) return null;
    return d.length !== 10 ? 'Enter a 10-digit phone number, including the area code.' : null;
  },
  message: (v) => (v.trim().length < 12 ? 'Add a sentence or two so we can give you a useful answer.' : null),
};

function errorEl(field: HTMLElement) {
  const id = `${field.id}-error`;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('p');
    el.id = id;
    el.className = 'field-error';
    el.setAttribute('aria-live', 'polite');
    field.insertAdjacentElement('afterend', el);
  }
  return el;
}

/** Error reported by the server for the field's current value. */
export function setServerError(field: HTMLInputElement | HTMLTextAreaElement, message: string) {
  field.dataset.serverError = field.value;
  setError(field, message);
}

export function setError(field: HTMLElement, message: string | null) {
  const el = errorEl(field);
  el.textContent = message ?? '';
  el.hidden = !message;
  if (message) {
    field.setAttribute('aria-invalid', 'true');
    const described = new Set((field.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean));
    described.add(el.id);
    field.setAttribute('aria-describedby', [...described].join(' '));
  } else {
    field.removeAttribute('aria-invalid');
  }
}

const isActive = (f: HTMLElement) => !f.closest('[hidden]') && !(f as HTMLInputElement).disabled;

export function validateField(field: HTMLInputElement | HTMLTextAreaElement) {
  if (!isActive(field)) return true;
  const rule = rules[field.dataset.rule ?? ''];
  if (!rule) return true;
  const optional = field.dataset.optional === 'true' && field.value.trim() === '';
  const msg = optional ? null : rule(field.value, field);
  setError(field, msg);
  return !msg;
}

export function attachValidation(form: HTMLFormElement) {
  form.noValidate = true;
  form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-rule]').forEach((field) => {
    // A server-reported error stays until the visitor edits the field, so blurring
    // (e.g. on the way to the submit button) doesn't shift the layout under the cursor.
    field.addEventListener('blur', () => {
      if (field.dataset.serverError !== undefined && field.dataset.serverError === field.value) return;
      validateField(field);
    });
    field.addEventListener('input', () => {
      delete field.dataset.serverError;
      if (field.getAttribute('aria-invalid') === 'true') validateField(field);
    });
  });
}

/** Validates every active field; focuses the first failure. */
export function validateForm(form: HTMLFormElement) {
  const fields = [...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-rule]')];
  const failed = fields.filter((f) => !validateField(f));
  failed[0]?.focus();
  return failed.length === 0;
}

export const formatPhone = (v: string) => {
  const d = digits(v).replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : v;
};
