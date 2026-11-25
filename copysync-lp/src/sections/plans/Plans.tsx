import { useEffect, useState } from 'react'
import { MarketLogo, MARKETPLACES } from '../../components/Marketplaces'
import { track, withCampaignParams } from '../../lib/track'
import { HINTS, PLANS, brl, priceFor, type Benefit, type Period, type Plan } from './data'
import { HintRow } from './Hint'
import {
  ChannelIcon,
  ChannelsIcon,
  CheckCircleIcon,
  CheckMark,
  CrownIcon,
  HeadsetIcon,
  LockIcon,
  RefreshIcon,
  SessionsIcon,
  TrendIcon,
} from './icons'

const GRAY = 'text-[#6b6f7b]'

/** Bloco 5 · PLANOS — réplica da página de Planos do app (app.copysync.app/affiliates/plans). */
export function Plans() {
  // a página abre no anual; a chave troca para o mensal
  const [period, setPeriod] = useState<Period>('annual')

  return (
    <section id="planos" aria-labelledby="planos-title" className="bg-[#f6f6fb] px-4 pb-10 pt-20 font-sans sm:px-6 sm:pt-24 lg:px-8">
      <div className="mx-auto max-w-[1180px]">
        <Header period={period} onPeriod={setPeriod} />

        <div className="mt-12 grid gap-8 lg:grid-cols-3 lg:items-stretch lg:gap-5">
          {PLANS.map((plan) => (
            <PlanCard key={plan.slug} plan={plan} period={period} />
          ))}
        </div>

        <Guarantee />

        <TrustBar />
      </div>
    </section>
  )
}

function Header({ period, onPeriod }: { period: Period; onPeriod: (p: Period) => void }) {
  return (
    <div className="rounded-[28px] border border-[#e7e6f3] bg-[linear-gradient(180deg,#efeefc_0%,#f6f5fd_65%,#ffffff_100%)] px-5 py-10 text-center sm:py-12">
      <Urgency className="mx-auto mb-4 max-w-md sm:max-w-none" />
      <h2 id="planos-title" className="text-[2rem] font-extrabold tracking-[-0.025em] text-[#111318] sm:text-[2.7rem]">
        Escolha seu plano
      </h2>
      <p className={`mx-auto mt-3 max-w-2xl text-[1.02rem] leading-relaxed sm:text-[1.15rem] ${GRAY}`}>
        <strong className="font-semibold text-[#111318]">Monitoramento, disparo e links de afiliado em todos os planos.</strong>{' '}
        O que muda é quantos grupos e canais você opera ao mesmo tempo.
      </p>

      <ul aria-label="Marketplaces integrados" className="mt-7 flex justify-center gap-3.5 sm:gap-4">
        {(['shopee', 'mercado-livre', 'amazon', 'shein'] as const).map((m) => (
          <li key={m} className="relative" title={m === 'shein' ? 'Shein: disponível no plano MAX' : MARKETPLACES[m].name}>
            <MarketLogo id={m} size={46} lgSize={52} />
            {m === 'shein' && (
              <span className="absolute -bottom-1.5 -right-2 rounded-md bg-brand px-1.5 py-px text-[10px] font-bold leading-[1.4] text-white ring-2 ring-white">
                MAX
              </span>
            )}
          </li>
        ))}
      </ul>

      <p className="mx-auto mt-8 flex w-fit max-w-full items-center gap-2 rounded-full bg-save-bg px-4 py-2 text-left text-[0.92rem] font-semibold leading-snug text-save-ink ring-1 ring-inset ring-[#bfe3c5] sm:text-[0.98rem]">
        <CalendarIcon />
        No plano anual à vista, você paga menos de 8 meses e usa 12.
      </p>
      <PriceLock className="mx-auto mt-3 max-w-md text-[0.9rem] sm:max-w-none" />

      <div
        role="radiogroup"
        aria-label="Período de cobrança"
        className="mt-4 inline-flex rounded-full bg-[#ebebf3] p-1 shadow-[inset_0_1px_2px_rgba(15,17,23,.06)]"
      >
        {(['monthly', 'annual'] as const).map((p) => {
          const active = period === p
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onPeriod(p)}
              className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2.5 text-[1.02rem] font-medium transition sm:px-6 ${active ? 'bg-[linear-gradient(100deg,#5869da,#7042e3)] text-white shadow-[0_6px_16px_-6px_rgba(91,101,219,.75)]' : 'text-[#55596a] hover:text-[#111318]'}`}
            >
              {p === 'monthly' ? 'Mensal' : 'Anual'}
              {p === 'annual' && (
                <span
                  className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[0.72rem] font-bold ${active ? 'bg-white/20 text-white' : 'bg-save-bg text-save-ink'}`}
                >
                  até −36% à vista
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PlanCard({ plan, period }: { plan: Plan; period: Period }) {
  const rec = !!plan.recommended
  const p = priceFor(plan, period)
  const url = plan.checkout[period]
  // UTMs/gclid da URL da página vão para o link do checkout (inclusive ao abrir em nova aba).
  const [href, setHref] = useState(url)
  useEffect(() => setHref(withCampaignParams(url)), [url])

  return (
    <article
      aria-label={`Plano ${plan.name}`}
      className={`relative flex flex-col rounded-[20px] bg-white p-6 sm:p-7 ${rec ? 'border-2 border-brand shadow-[0_28px_60px_-30px_rgba(91,101,219,.6)]' : 'border border-[#e9e9f1] shadow-[0_1px_2px_rgba(15,17,23,.04)]'}`}
    >
      {rec && (
        <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-brand px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-white">
          Mais escolhido
        </span>
      )}

      <h3 className="flex items-center gap-2 text-[1.45rem] font-bold tracking-[-0.01em] text-[#111318]">
        {rec && <CrownIcon className="size-5 text-brand" />}
        {plan.name}
      </h3>
      <p className={`mt-1.5 text-[0.95rem] ${GRAY}`}>{plan.tagline}</p>

      <p className="mt-6 text-[0.8rem] font-semibold text-[#737784] line-through decoration-[#737784]">de {brl(p.from)}</p>
      <div className="mt-0.5 flex items-end gap-2">
        <span className="text-[2.6rem] font-bold leading-none tracking-[-0.025em] text-[#111318]">{brl(p.price)}</span>
        <span className={`pb-0.5 text-[0.95rem] leading-[1.15] ${GRAY}`}>
          /mês
          <span className="block text-[0.78rem] tracking-[0.01em]">{p.billed}</span>
        </span>
      </div>
      {period === 'annual' && <p className={`mt-2 text-[0.78rem] leading-snug ${GRAY}`}>{plan.annualDetail}</p>}
      <span className="mt-3 w-fit rounded-md bg-save-bg px-2 py-1 text-[0.78rem] font-bold text-save-ink">{p.savings}</span>

      <a
        href={href}
        onClick={() => {
          const periodo = period === 'annual' ? 'anual' : 'mensal'
          track('plan_select', { plano: plan.name, periodo })
          track('checkout_start', { plano: plan.name, periodo })
        }}
        className={`mt-5 inline-flex h-12 items-center justify-center rounded-xl text-[1.02rem] font-semibold transition active:scale-[.99] ${rec ? 'bg-[linear-gradient(100deg,#5869da,#7042e3)] text-white shadow-[0_8px_20px_-8px_rgba(91,101,219,.8)] hover:brightness-110' : 'border border-[#c9cdf0] bg-white text-brand hover:bg-brand-soft'}`}
      >
        Assinar {plan.name}
      </a>
      <p className={`mt-2.5 text-center text-[0.8rem] ${GRAY}`}>Sem fidelidade. Cancele quando quiser.</p>

      <hr className="my-6 border-[#ececf2]" />

      <ChannelTable plan={plan} />

      <HintRow
        hint={HINTS.mercadoLivreTags}
        label="Etiquetas do Mercado Livre"
        className="mt-5 flex items-center gap-2.5 pr-8"
      >
        <MarketLogo id="mercado-livre" size={22} decorative />
        <p className="leading-tight">
          <span className={`block text-[0.85rem] ${GRAY}`}>Etiquetas do Mercado Livre</span>
          <b className="text-[0.92rem] text-[#111318]">
            {plan.limits.mercadoLivreTags} {plan.limits.mercadoLivreTags === 1 ? 'etiqueta' : 'etiquetas'}
          </b>
        </p>
      </HintRow>

      <ul className="mt-5 flex-1 space-y-3">
        {plan.benefits.map((b) => (
          <li key={b.label}>
            <BenefitItem b={b} />
          </li>
        ))}
      </ul>

      <p className={`mt-7 border-t border-[#ececf2] pt-5 text-[0.8rem] leading-relaxed ${GRAY}`}>
        <b className="font-bold text-[#111318]">Ideal para</b> {plan.fit}
      </p>
    </article>
  )
}

function ChannelTable({ plan }: { plan: Plan }) {
  const l = plan.limits
  const hasTelegram = l.telegramSessions > 0
  const rows: { label: string; hint?: string; wa: React.ReactNode; tg: React.ReactNode }[] = [
    { label: 'Sessões', wa: l.whatsappSessions, tg: l.telegramSessions },
    { label: 'Grupos monitorados', hint: HINTS.monitoredGroups, wa: l.monitoredGroups, tg: l.telegramMonitoredGroups },
    { label: 'Grupos de disparo', hint: HINTS.broadcastGroups, wa: l.broadcastGroups, tg: l.telegramBroadcastGroups },
    {
      label: 'Gestor de Links',
      hint: HINTS.linkRotation,
      wa: <LinkCell links={l.linkRotations} groups={l.linkRotationGroups} />,
      tg: <LinkCell links={l.telegramLinkRotations} groups={l.telegramLinkRotationGroups} />,
    },
  ]

  return (
    <div
      role="group"
      aria-label={`Limites por canal no plano ${plan.name}`}
      className="grid grid-cols-[minmax(0,1fr)_80px_80px] overflow-visible rounded-xl border border-[#ececf2] bg-[#fcfcfe]"
    >
      <div className="contents">
        <span aria-hidden="true" />
        <ChannelHead channel="whatsapp" />
        <ChannelHead channel="telegram" muted={!hasTelegram} />
      </div>

      {rows.map((r, i) => (
        <div key={r.label} className="contents">
          <HintRow
            hint={r.hint}
            label={r.label}
            className="flex min-h-[46px] items-center border-t border-[#f0f0f5] py-2 pl-3 pr-8"
          >
            <span className={`text-[0.85rem] leading-tight ${GRAY}`}>
              {r.label}
            </span>
          </HintRow>
          <span className="grid place-items-center border-t border-[#f0f0f5] text-center text-[0.95rem] font-bold text-[#111318]">
            {r.wa}
          </span>
          {hasTelegram ? (
            <span className="grid place-items-center border-t border-[#f0f0f5] text-center text-[0.95rem] font-bold text-[#111318]">
              {r.tg}
            </span>
          ) : (
            i === 0 && (
              <span
                className={`col-start-3 row-span-4 grid place-items-center border-t border-[#f0f0f5] bg-[#f6f6f9] px-1 text-center text-[0.78rem] font-medium leading-snug ${GRAY}`}
                style={{ gridRow: '2 / span 4' }}
              >
                A partir do PRO
              </span>
            )
          )}
        </div>
      ))}
    </div>
  )
}

function ChannelHead({ channel, muted = false }: { channel: 'whatsapp' | 'telegram'; muted?: boolean }) {
  return (
    <span className="flex flex-col items-center gap-1 py-3">
      <ChannelIcon channel={channel} muted={muted} className="size-[18px]" />
      <span className={`text-[0.78rem] font-bold ${muted ? 'text-[#696d7a]' : 'text-[#111318]'}`}>
        {channel === 'whatsapp' ? 'WhatsApp' : 'Telegram'}
      </span>
    </span>
  )
}

function LinkCell({ links, groups }: { links: number; groups: number }) {
  return (
    <span className="leading-tight">
      {links} {links === 1 ? 'link' : 'links'}
      <span className="block text-[0.68rem] font-normal text-[#696d7a]">até {groups} grupos</span>
    </span>
  )
}

function ExclusiveChip() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-md border border-[#9c87f2] bg-white px-1.5 py-px text-[0.68rem] font-bold text-violet">
      Exclusivo
    </span>
  )
}

function BenefitItem({ b }: { b: Benefit }) {
  if (b.feature) {
    return (
      <HintRow hint={b.hint} label={b.feature.name} className="rounded-xl border-[1.5px] border-[#9c87f2] bg-lilac py-3 pl-3 pr-9" iconClassName="right-2 top-5">
        <div className="flex gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[linear-gradient(135deg,#5869da,#7042e3)] text-white">
            {b.feature.icon === 'sessions' ? <SessionsIcon /> : <ChannelsIcon />}
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-1.5 text-[0.95rem] font-bold text-violet">
              {b.feature.name}
              {b.exclusive && <ExclusiveChip />}
            </p>
            <p className={`mt-0.5 text-[0.85rem] leading-snug ${GRAY}`}>{b.label}</p>
          </div>
        </div>
      </HintRow>
    )
  }

  if (b.spotlight) {
    return (
      <HintRow hint={b.hint} label={b.label} className="rounded-xl border-[1.5px] border-[#9c87f2] bg-lilac py-3 pl-3 pr-9">
        <div className="flex items-center gap-3">
          <MarketLogo id="shein" size={36} decorative />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-1.5 text-[0.95rem] font-bold text-[#111318]">
              {b.label}
              <span className="rounded-md bg-brand px-1.5 py-px text-[0.62rem] font-bold uppercase tracking-[0.12em] text-white">
                Novidade
              </span>
            </p>
            {b.exclusive && (
              <p className="mt-1">
                <ExclusiveChip />
              </p>
            )}
            <p className={`mt-1 text-[0.85rem] leading-snug ${GRAY}`}>{b.spotlight.detail}</p>
          </div>
        </div>
      </HintRow>
    )
  }

  if (b.telegram) {
    return (
      <HintRow hint={b.hint} label={b.label} className="rounded-xl border border-[#cfe0f3] bg-[#eef5fc] py-2.5 pl-3 pr-9" iconClassName="right-2">
        <div className="flex gap-2.5">
          <ChannelIcon channel="telegram" className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="text-[0.88rem] font-bold leading-snug text-[#111318]">{b.label}</p>
            {b.telegram.detail && <p className={`text-[0.82rem] ${GRAY}`}>{b.telegram.detail}</p>}
          </div>
        </div>
      </HintRow>
    )
  }

  if (b.marketplaces) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl bg-[#f3f3f7] px-3 py-2.5">
        <span className="flex shrink-0 items-center gap-1">
          {b.marketplaces.map((m) => (
            <img key={m} src={MARKETPLACES[m].src} alt="" width={16} height={16} className="size-4 object-contain" />
          ))}
        </span>
        <span className="text-[0.88rem] font-bold text-[#111318]">{b.label}</span>
      </div>
    )
  }

  return (
    <HintRow hint={b.hint} label={b.label} className="flex items-start gap-2.5 pr-8">
      <CheckMark className="mt-[3px] size-4 shrink-0 text-brand" />
      <span className={`text-[0.9rem] leading-snug ${b.strong ? 'font-bold text-[#111318]' : GRAY}`}>
        {b.label}
        {b.exclusive && (
          <>
            {' '}
            <ExclusiveChip />
          </>
        )}
      </span>
    </HintRow>
  )
}

/** Frase de urgência (verdadeira: as ofertas saem nos grupos o dia todo). Também no bloco de fechamento. */
export function Urgency({ className = '' }: { className?: string }) {
  return (
    <p className={`text-[0.95rem] font-semibold leading-snug text-[#3b3f4c] text-balance ${className}`}>
      <svg viewBox="0 0 24 24" className="mr-1.5 inline-block size-[18px] align-[-4px] text-alarm" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </svg>
      Enquanto você decide, as ofertas de hoje estão saindo com o link de outro afiliado.
    </p>
  )
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4M9 14.5l2 2 4-4" />
    </svg>
  )
}

/** Trava de preço (planos e fechamento). */
export function PriceLock({ className = '' }: { className?: string }) {
  return (
    <p className={`font-medium leading-snug text-[#3b3f4c] text-balance ${className}`}>
      <LockIcon className="mr-1.5 inline-block size-[15px] align-[-2px] text-ink" />
      <strong className="font-bold text-ink">Preço travado:</strong> assinando agora, você mantém este valor enquanto sua
      assinatura estiver ativa.
    </p>
  )
}

/** Garantia em destaque, logo abaixo dos cartões. */
function Guarantee() {
  return (
    <div className="mx-auto mt-10 flex max-w-3xl flex-col items-center gap-4 sm:w-fit rounded-[24px] border border-[#cfe9d4] bg-white px-6 py-7 text-center shadow-[0_1px_2px_rgba(15,17,23,.04)] sm:flex-row sm:gap-6 sm:px-8 sm:text-left">
      <span aria-hidden="true" className="relative grid size-[72px] shrink-0 place-items-center rounded-full bg-save-bg ring-[6px] ring-[#eef8f0]">
        <svg viewBox="0 0 24 24" className="size-9 text-ok" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round">
          <path d="M12 2.8 4.5 5.9v5.3c0 4.7 3.1 8.6 7.5 10 4.4-1.4 7.5-5.3 7.5-10V5.9L12 2.8Z" fill="#ffffff" />
          <path d="m8.7 12.2 2.3 2.3 4.4-4.6" />
        </svg>
        <span className="absolute -bottom-2 rounded-full bg-save-ink px-2 py-px text-[0.68rem] font-extrabold tracking-[0.06em] text-white">7 DIAS</span>
      </span>
      <p className="text-[1.15rem] font-bold leading-snug text-[#111318] text-balance sm:text-[1.3rem]">
        <span className="sm:block">Teste nos seus grupos por 7 dias.</span>{' '}
        <span className="sm:block">Se não fizer sentido, devolvemos 100%.</span>
      </p>
    </div>
  )
}

function TrustBar() {
  const items = [
    { icon: <LockIcon />, label: 'Pagamento seguro e criptografado' },
    { icon: <RefreshIcon />, label: 'Cancele quando quiser' },
    { icon: <TrendIcon />, label: 'Faça upgrade a qualquer momento' },
    { icon: <HeadsetIcon />, label: 'Suporte humano de verdade' },
    { icon: <CheckCircleIcon />, label: '7 dias de garantia, 100% de volta' },
  ]
  return (
    <div className="mt-10 border-t border-[#e6e6ef] pt-6">
      <ul className={`flex flex-wrap justify-center gap-x-7 gap-y-3 text-[0.82rem] ${GRAY}`}>
        {items.map((i) => (
          <li key={i.label} className="flex items-center gap-1.5">
            <span className="text-ok">{i.icon}</span>
            {i.label}
          </li>
        ))}
      </ul>
      <p className="mx-auto mt-5 max-w-2xl text-center text-[0.75rem] leading-relaxed text-[#6b6f7b]">
        Limites de uso se aplicam. Preços e planos sujeitos a alteração. Assinatura com renovação automática. Taxa de
        serviço de R$ 0,99 aplicada pela plataforma de pagamento no checkout.
      </p>
    </div>
  )
}
