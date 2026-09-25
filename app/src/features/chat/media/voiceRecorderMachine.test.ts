import { describe, it, expect } from 'vitest';
import {
  errorKindFromException,
  initialVoiceRecorderState,
  voiceRecorderReducer,
  type MicrophoneErrorKind,
  type VoiceRecorderEvent,
  type VoiceRecorderState,
} from './voiceRecorderMachine';

const run = (state: VoiceRecorderState, ...events: VoiceRecorderEvent[]) => events.reduce(voiceRecorderReducer, state);
const at = (status: VoiceRecorderState['status'], extra: Partial<VoiceRecorderState> = {}): VoiceRecorderState => ({
  ...initialVoiceRecorderState,
  status,
  ...extra,
});
const tick = (ms: number): VoiceRecorderEvent => ({ type: 'TICK', ms });

describe('gravador de voz: iniciar', () => {
  it('começa ocioso, sem tempo, erro ou aviso', () => {
    expect(initialVoiceRecorderState).toEqual({
      status: 'idle',
      elapsedMs: 0,
      maxReached: false,
      previewUnsupported: false,
      errorKind: null,
      notice: null,
    });
  });

  it('clicar no microfone pede permissão', () => {
    expect(run(initialVoiceRecorderState, { type: 'REQUEST' }).status).toBe('requesting');
  });

  it('nova tentativa depois de erro pede permissão de novo e limpa a causa', () => {
    const s = run(at('error', { errorKind: 'permission' }), { type: 'REQUEST' });
    expect(s).toEqual(at('requesting'));
  });

  it('nova gravação limpa o aviso de gravação muito curta', () => {
    const s = run(at('idle', { notice: 'tooShort' }), { type: 'REQUEST' });
    expect(s.notice).toBeNull();
  });

  it('permissão concedida abre a barra gravando do zero', () => {
    expect(run(at('requesting'), { type: 'GRANTED' })).toEqual(at('recording'));
  });

  it.each<MicrophoneErrorKind>(['permission', 'no_device', 'in_use', 'insecure', 'unsupported', 'unknown'])(
    'microfone indisponível (%s) mostra a causa específica',
    (errorKind) => {
      expect(run(at('requesting'), { type: 'DENIED', errorKind })).toEqual(at('error', { errorKind }));
    },
  );
});

describe('gravador de voz: cronômetro, pausa e máximo', () => {
  it('soma o tempo gravado a cada tique', () => {
    expect(run(at('recording'), tick(250), tick(250), tick(300)).elapsedMs).toBe(800);
  });

  it('pausar para o cronômetro', () => {
    expect(run(at('recording', { elapsedMs: 1200 }), { type: 'PAUSE' })).toEqual(at('paused', { elapsedMs: 1200 }));
  });

  it('retomar continua do mesmo tempo', () => {
    expect(run(at('paused', { elapsedMs: 1200 }), { type: 'RESUME' })).toEqual(at('recording', { elapsedMs: 1200 }));
  });

  it('o tempo gravado exclui as pausas', () => {
    const s = run(at('recording'), tick(600), { type: 'PAUSE' }, tick(5000), { type: 'RESUME' }, tick(700));
    expect(s.elapsedMs).toBe(1300);
  });

  it('tique sem tempo positivo não muda nada', () => {
    const recording = at('recording', { elapsedMs: 500 });
    expect(run(recording, tick(0))).toBe(recording);
    expect(run(recording, tick(-10))).toBe(recording);
    expect(run(recording, tick(Number.NaN))).toBe(recording);
  });

  it('atingir o máximo pausa sozinho, sem enviar', () => {
    const s = run(at('recording', { elapsedMs: 900_000 }), { type: 'MAX_REACHED' });
    expect(s).toEqual(at('paused', { elapsedMs: 900_000, maxReached: true }));
  });

  it('no máximo não dá para retomar', () => {
    const full = at('paused', { elapsedMs: 900_000, maxReached: true });
    expect(run(full, { type: 'RESUME' })).toBe(full);
  });

  it('no máximo ainda dá para enviar', () => {
    expect(run(at('paused', { elapsedMs: 900_000, maxReached: true }), { type: 'SEND' }).status).toBe('sending');
  });
});

describe('gravador de voz: pré-escuta', () => {
  it('pré-escuta que falha fica marcada como não suportada, sem impedir retomar', () => {
    const s = run(at('paused', { elapsedMs: 2000 }), { type: 'PREVIEW_FAILED' });
    expect(s).toEqual(at('paused', { elapsedMs: 2000, previewUnsupported: true }));
    expect(run(s, { type: 'RESUME' })).toEqual(at('recording', { elapsedMs: 2000, previewUnsupported: true }));
  });

  it('falha da pré-escuta que chega depois de retomar também marca', () => {
    expect(run(at('recording'), { type: 'PREVIEW_FAILED' }).previewUnsupported).toBe(true);
  });

  it('falha da pré-escuta no rascunho também marca', () => {
    expect(run(at('draft', { elapsedMs: 3000 }), { type: 'PREVIEW_FAILED' }).previewUnsupported).toBe(true);
  });
});

describe('gravador de voz: trocar de conversa', () => {
  it('sair da conversa gravando guarda como rascunho', () => {
    expect(run(at('recording', { elapsedMs: 4000 }), { type: 'LEAVE_CONVERSATION' })).toEqual(
      at('draft', { elapsedMs: 4000 }),
    );
  });

  it('sair da conversa pausado guarda como rascunho', () => {
    expect(run(at('paused', { elapsedMs: 4000 }), { type: 'LEAVE_CONVERSATION' })).toEqual(
      at('draft', { elapsedMs: 4000 }),
    );
  });

  it('rascunho só envia ou descarta: retomar, pausar e tique não fazem nada', () => {
    const draft = at('draft', { elapsedMs: 4000 });
    expect(run(draft, { type: 'RESUME' })).toBe(draft);
    expect(run(draft, { type: 'PAUSE' })).toBe(draft);
    expect(run(draft, tick(250))).toBe(draft);
  });

  it('rascunho enviado vai para envio', () => {
    expect(run(at('draft', { elapsedMs: 4000 }), { type: 'SEND' })).toEqual(at('sending', { elapsedMs: 4000 }));
  });

  it('rascunho descartado volta ao composer', () => {
    expect(run(at('draft', { elapsedMs: 4000 }), { type: 'DISCARD' })).toEqual(initialVoiceRecorderState);
  });
});

describe('gravador de voz: enviar e descartar', () => {
  it('enviar gravando vai para envio', () => {
    expect(run(at('recording', { elapsedMs: 10_000 }), { type: 'SEND' })).toEqual(
      at('sending', { elapsedMs: 10_000 }),
    );
  });

  it('enviar pausado vai para envio', () => {
    expect(run(at('paused', { elapsedMs: 10_000 }), { type: 'SEND' }).status).toBe('sending');
  });

  it('exatamente 1 s já pode ser enviado', () => {
    expect(run(at('recording', { elapsedMs: 1000 }), { type: 'SEND' }).status).toBe('sending');
  });

  it('menos de 1 s é descartado com aviso de gravação muito curta', () => {
    expect(run(at('recording', { elapsedMs: 999 }), { type: 'SEND' })).toEqual(at('idle', { notice: 'tooShort' }));
  });

  it('rascunho com menos de 1 s também é descartado com aviso', () => {
    expect(run(at('draft', { elapsedMs: 300 }), { type: 'SEND' })).toEqual(at('idle', { notice: 'tooShort' }));
  });

  it('envio concluído volta ao composer', () => {
    expect(run(at('sending', { elapsedMs: 10_000 }), { type: 'SENT' })).toEqual(initialVoiceRecorderState);
  });

  it('descartar gravando volta ao composer sem enviar', () => {
    expect(run(at('recording', { elapsedMs: 5000 }), { type: 'DISCARD' })).toEqual(initialVoiceRecorderState);
  });

  it('descartar pausado volta ao composer sem enviar', () => {
    expect(run(at('paused', { elapsedMs: 5000, previewUnsupported: true }), { type: 'DISCARD' })).toEqual(
      initialVoiceRecorderState,
    );
  });

  it.each<VoiceRecorderState['status']>(['idle', 'requesting', 'recording', 'paused', 'draft', 'sending', 'error'])(
    'reiniciar a partir de %s volta ao estado inicial',
    (status) => {
      const s = run(at(status, { elapsedMs: 3000, errorKind: 'in_use', notice: 'tooShort' }), { type: 'RESET' });
      expect(s).toEqual(initialVoiceRecorderState);
    },
  );
});

describe('gravador de voz: transições inválidas devolvem o mesmo estado', () => {
  const cases: [VoiceRecorderState['status'], VoiceRecorderEvent][] = [
    ['idle', { type: 'GRANTED' }],
    ['idle', { type: 'DENIED', errorKind: 'permission' }],
    ['idle', { type: 'PAUSE' }],
    ['idle', { type: 'RESUME' }],
    ['idle', { type: 'SEND' }],
    ['idle', { type: 'SENT' }],
    ['idle', { type: 'DISCARD' }],
    ['idle', { type: 'LEAVE_CONVERSATION' }],
    ['idle', { type: 'MAX_REACHED' }],
    ['idle', { type: 'PREVIEW_FAILED' }],
    ['idle', tick(250)],
    ['requesting', { type: 'REQUEST' }],
    ['requesting', { type: 'SEND' }],
    ['requesting', { type: 'PAUSE' }],
    ['requesting', { type: 'LEAVE_CONVERSATION' }],
    ['requesting', tick(250)],
    ['recording', { type: 'REQUEST' }],
    ['recording', { type: 'GRANTED' }],
    ['recording', { type: 'RESUME' }],
    ['recording', { type: 'SENT' }],
    ['paused', { type: 'PAUSE' }],
    ['paused', { type: 'MAX_REACHED' }],
    ['paused', tick(250)],
    ['draft', { type: 'REQUEST' }],
    ['draft', { type: 'LEAVE_CONVERSATION' }],
    ['draft', { type: 'MAX_REACHED' }],
    ['sending', { type: 'SEND' }],
    ['sending', { type: 'DISCARD' }],
    ['sending', { type: 'LEAVE_CONVERSATION' }],
    ['sending', { type: 'PAUSE' }],
    ['sending', tick(250)],
    ['error', { type: 'GRANTED' }],
    ['error', { type: 'SEND' }],
    ['error', { type: 'DISCARD' }],
  ];

  it.each(cases)('%s ignora %o', (status, event) => {
    const state = at(status, { elapsedMs: 2000 });
    expect(voiceRecorderReducer(state, event)).toBe(state);
  });
});

describe('causa do erro de microfone pela exceção do navegador', () => {
  it.each<[string, MicrophoneErrorKind]>([
    ['NotAllowedError', 'permission'],
    ['SecurityError', 'permission'],
    ['NotFoundError', 'no_device'],
    ['OverconstrainedError', 'no_device'],
    ['NotReadableError', 'in_use'],
    ['AbortError', 'in_use'],
  ])('%s vira %s', (name, kind) => {
    expect(errorKindFromException(new DOMException('falhou', name))).toBe(kind);
  });

  it('reconhece pelo nome também em erro que não é DOMException', () => {
    const err = Object.assign(new Error('negado'), { name: 'NotAllowedError' });
    expect(errorKindFromException(err)).toBe('permission');
  });

  it.each([new TypeError('sem mediaDevices'), new Error('qualquer'), 'texto', null, undefined, { name: 42 }])(
    'qualquer outra coisa (%o) vira desconhecido',
    (err) => {
      expect(errorKindFromException(err)).toBe('unknown');
    },
  );
});
