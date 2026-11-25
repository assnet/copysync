import { LoopClip } from '../components/LoopClip'
import { ScreenFrame } from '../components/ScreenFrame'
import { CLIPS } from '../media/clips'
import { VideoFacade } from './VideoFacade'

/** Bloco 4 · CONFIGURAÇÃO — clipe dos tutoriais do painel real + vídeo de apresentação. */
export function Demo() {
  return (
    <section id="demonstracao" aria-labelledby="demo-title" className="overflow-x-clip bg-white px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2
            id="demo-title"
            className="font-display text-[2.1rem] font-extrabold leading-[1.06] tracking-[-0.03em] text-ink text-balance sm:text-5xl"
          >
            Configure Uma Vez. Veja a Rota Rodar.
          </h2>
          <p className="mt-4 text-lg text-muted">
            Videoaulas curtas guiam cada passo: conectar o WhatsApp, cadastrar suas credenciais de afiliado e ligar o
            Monitoramento.
          </p>
        </div>

        <figure className="mx-auto mt-12 max-w-[420px] sm:mt-14 sm:max-w-4xl">
          <ScreenFrame>
            <LoopClip
              clip={CLIPS.tutorial}
              label="Gravação do painel: tela de Tutoriais com 13 aulas em 3 trilhas, como Conectando sessões e Instalando a extensão."
            />
          </ScreenFrame>
          <figcaption className="mt-3 text-center text-sm text-muted">Tutoriais passo a passo, no painel real.</figcaption>
        </figure>

        <VideoFacade />
      </div>
    </section>
  )
}
