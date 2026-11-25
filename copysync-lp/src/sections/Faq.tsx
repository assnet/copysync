import type { ReactNode } from 'react'
import { SUPPORT } from '../config'

const QA: { q: string; a: ReactNode }[] = [
  {
    q: 'Preciso deixar o computador ligado?',
    a: (
      <p>
        Não. A CopySync funciona com o seu computador desligado: depois que você configura os grupos de onde vêm as
        ofertas e os grupos de destino, a Rota continua trabalhando sem depender do seu computador nem de um navegador
        aberto. O que precisa continuar ativo é a sessão do seu WhatsApp ou Telegram conectada à CopySync.
      </p>
    ),
  },
  {
    q: 'O dono do grupo monitorado percebe?',
    a: (
      <p>
        A CopySync entra no grupo como um participante comum: ela só lê as ofertas e não envia nenhuma mensagem nele.
      </p>
    ),
  },
  {
    q: 'Preciso saber de tecnologia?',
    a: (
      <p>
        Não. O painel tem videoaulas curtas (13 aulas em 3 trilhas) que mostram cada passo: conectar o WhatsApp,
        cadastrar suas credenciais de afiliado e ligar o Monitoramento.
      </p>
    ),
  },
  {
    q: 'Funciona com quais marketplaces?',
    a: (
      <p>
        Shopee, Mercado Livre e Amazon em todos os planos. A Shein entra no plano MAX (Afiliado Shein e Caçador de
        Ofertas), com o aceite de um aviso de risco antes do uso.
      </p>
    ),
  },
  {
    q: 'Existe risco de restrição no WhatsApp?',
    a: (
      <>
        <p>
          Sim. O WhatsApp pode restringir números que usam automação, principalmente quando há envios em excesso ou para
          quem não quer receber. Ninguém consegue garantir que um número nunca será restringido. Boas práticas reduzem
          o risco:
        </p>
        <ul className="mt-3 list-disc space-y-1.5 pl-5">
          <li>publique só nos seus grupos, com membros que entraram porque quiseram;</li>
          <li>mantenha intervalos entre as ofertas e evite volumes muito altos de uma vez;</li>
          <li>prefira números já em uso há algum tempo, e não números recém-criados;</li>
          <li>respeite quem pede para sair e as regras do próprio WhatsApp.</li>
        </ul>
      </>
    ),
  },
  {
    q: 'A CopySync garante comissões?',
    a: (
      <p>
        Não. A CopySync automatiza a publicação das ofertas nos seus grupos, já com o seu link de afiliado. As vendas e
        as comissões dependem do seu público, das ofertas e das regras de cada programa de afiliados.
      </p>
    ),
  },
  {
    q: 'O preço pode aumentar depois que eu assinar?',
    a: (
      <p>
        Não enquanto sua assinatura estiver ativa. Quem assina mantém o valor contratado nas renovações, mesmo que os
        preços da CopySync mudem para novos clientes. Se você cancelar e voltar depois, vale o preço da época.
      </p>
    ),
  },
  {
    q: 'Como cancelo ou peço reembolso?',
    a: (
      <>
        <p>
          Você tem 7 dias de garantia: se não gostar, devolvemos 100% do valor pago. Para pedir o reembolso ou cancelar,
          fale com o suporte pelo WhatsApp{' '}
          <a href={SUPPORT.whatsappUrl} className="font-semibold text-brand underline-offset-4 hover:underline">
            {SUPPORT.whatsappLabel}
          </a>
          .
        </p>
        <p className="mt-3">
          Não há fidelidade: você pode cancelar quando quiser e a renovação automática é interrompida. No plano anual,
          depois dos 7 dias de garantia, você recebe o reembolso proporcional ao período que ainda não usou.
        </p>
      </>
    ),
  },
]

/** FAQ (8 perguntas, acordeão nativo, sem JS). */
export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="bg-[#f6f6fb] px-4 pb-24 pt-14 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <h2 id="faq-title" className="text-center font-display text-3xl font-extrabold tracking-[-0.025em] text-ink sm:text-4xl">
          Perguntas frequentes
        </h2>
        <div className="mt-8 space-y-3">
          {QA.map(({ q, a }) => (
            <details
              key={q}
              className="group rounded-[20px] bg-white px-5 shadow-[0_1px_2px_rgba(15,17,23,.04)] ring-1 ring-[#e9e9f1] open:ring-brand/30 sm:px-6"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left font-display text-[1.05rem] font-bold text-ink [&::-webkit-details-marker]:hidden">
                {q}
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-brand transition-transform duration-300 group-open:rotate-45">
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
              </summary>
              <div className="pb-5 text-[0.98rem] leading-relaxed text-muted">{a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
