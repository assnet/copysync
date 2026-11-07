/**
 * Dados do usuário logado que o painel anexa ao link de pagamento hospedado (autopreenchimento).
 *
 * Só sai valor que o formulário do gateway aceita: valor fora do padrão ele recusa e o comprador
 * teria de apagar. Padrões copiados do checkout hospedado (mesmos da API central). Telefone e
 * documento não saem: o gateway ignora telefone na URL e o produto não guarda CPF/CNPJ.
 * Função pura. Doc: docs/planos.md, seção "Links de pagamento".
 */

export const CHECKOUT_NAME_PATTERN = /^[\p{Script=Latin}\p{M}\s]+$/u;
export const CHECKOUT_EMAIL_PATTERN =
  /^[a-zA-Z0-9._%+-]+@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
export const CHECKOUT_NAME_MAX = 100;

export interface CheckoutPrefillSource {
  email: string | null;
  name: string | null;
}

export interface CheckoutPrefill {
  email?: string;
  confirmEmail?: string;
  name?: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function buildCheckoutPrefill(source: CheckoutPrefillSource | null | undefined): CheckoutPrefill {
  const prefill: CheckoutPrefill = {};
  if (!source || typeof source !== 'object') return prefill;

  const email = text(source.email).toLowerCase();
  if (CHECKOUT_EMAIL_PATTERN.test(email)) {
    prefill.email = email;
    prefill.confirmEmail = email;
  }

  // Nome fora do padrão é omitido, nunca alterado (tirar caractere daria outro nome).
  const name = text(source.name).replace(/\s+/g, ' ');
  if (name && name.length <= CHECKOUT_NAME_MAX && CHECKOUT_NAME_PATTERN.test(name)) prefill.name = name;

  return prefill;
}
