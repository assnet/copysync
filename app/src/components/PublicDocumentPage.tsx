import { useEffect, type ReactNode } from 'react';
import { ThemeModeSelector } from './ThemeModeSelector';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Container, Link, Typography } from '@mui/material';
import { APP_NAME } from '@/shared/branding/brand';
import { BrandLogo } from '@/shared/branding/BrandLogo';

/**
 * Seção de documento público (Política de Privacidade, Suporte). Item `**x:** y` vira
 * negrito no prefixo; e-mail e URL isolados viram link; `{{app}}` vira `APP_NAME`.
 */
export interface DocumentSection {
  title: string;
  /** Parágrafos antes das listas. */
  intro?: readonly string[];
  /** Blocos: subtítulo opcional + parágrafos e/ou itens. */
  blocks?: readonly {
    subtitle?: string;
    paragraphs?: readonly string[];
    items?: readonly string[];
  }[];
  /** Parágrafos depois das listas. */
  outro?: readonly string[];
}

const brand = (text: string) => text.split('{{app}}').join(APP_NAME);

function RichText({ text }: { text: string }) {
  const m = /^\*\*(.+?)\*\*\s*(.*)$/s.exec(text);
  const [bold, rest] = m ? [m[1], m[2]] : [null, text];
  const linkify = (t: string) => {
    if (/^https?:\/\/\S+$/.test(t)) return <Link href={t} target="_blank" rel="noopener noreferrer">{t}</Link>;
    if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(t)) return <Link href={`mailto:${t}`}>{t}</Link>;
    if (/^\/[\w\-/]*$/.test(t)) return <Link component={RouterLink} to={t}>{t}</Link>;
    return t;
  };
  return (
    <>
      {bold && <Box component="strong" sx={{ fontWeight: 600 }}>{brand(bold)}</Box>}
      {bold ? ' ' : ''}
      {linkify(brand(rest))}
    </>
  );
}

function Paragraphs({ items }: { items?: readonly string[] }) {
  if (!items?.length) return null;
  return (
    <>
      {items.map((p) => (
        <Typography key={p} paragraph sx={{ mb: 1.25 }}>
          <RichText text={p} />
        </Typography>
      ))}
    </>
  );
}

function Section({ section }: { section: DocumentSection }) {
  return (
    <Box component="section" sx={{ mt: 4, pt: 2, borderTop: 1, borderColor: 'divider' }}>
      <Typography component="h2" variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>
        {brand(section.title)}
      </Typography>
      <Paragraphs items={section.intro} />
      {section.blocks?.map((b, i) => (
        <Box key={b.subtitle ?? i}>
          {b.subtitle && (
            <Typography component="h3" variant="subtitle1" fontWeight={600} sx={{ mt: 2, mb: 0.75 }}>
              {brand(b.subtitle)}
            </Typography>
          )}
          <Paragraphs items={b.paragraphs} />
          {b.items && (
            <Box component="ul" sx={{ m: 0, mb: 1.25, pl: 2.5 }}>
              {b.items.map((item) => (
                <Typography key={item} component="li" sx={{ mb: 0.75 }}>
                  <RichText text={item} />
                </Typography>
              ))}
            </Box>
          )}
        </Box>
      ))}
      <Paragraphs items={section.outro} />
    </Box>
  );
}

export interface PublicDocumentPageProps {
  /** `<title>` da aba (recebe ` · APP_NAME`). */
  pageTitle: string;
  title: string;
  /** Linha discreta sob o título (ex.: "Última atualização"). */
  subtitle?: string;
  intro?: readonly string[];
  sections: readonly DocumentSection[];
  backToLogin: string;
  /** Conteúdo extra entre a introdução e as seções (ex.: cartões de contato). */
  children?: ReactNode;
}

/**
 * Layout de página pública (sem login, light/dark, marca só via `APP_NAME`) usado pela
 * Política de Privacidade e pela página de Suporte — URLs declaradas na Chrome Web Store.
 */
export function PublicDocumentPage({ pageTitle, title, subtitle, intro, sections, backToLogin, children }: PublicDocumentPageProps) {

  useEffect(() => {
    const prev = document.title;
    document.title = `${pageTitle} · ${APP_NAME}`;
    return () => { document.title = prev; };
  }, [pageTitle]);

  return (
    <Box component="main" sx={{ minHeight: '100vh', bgcolor: 'background.default', color: 'text.primary' }}>
      <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 4 }}>
          <Link component={RouterLink} to="/login" underline="none" color="inherit" sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <BrandLogo size={36} />
            <Typography fontWeight={700}>{APP_NAME}</Typography>
          </Link>
          <ThemeModeSelector />
        </Box>

        <Typography component="h1" variant="h4" fontWeight={800} sx={{ letterSpacing: -0.5, mb: 0.5 }}>
          {brand(title)}
        </Typography>
        {subtitle && <Typography color="text.secondary" sx={{ mb: 3 }}>{brand(subtitle)}</Typography>}

        <Paragraphs items={intro} />
        {children}
        {sections.map((section) => <Section key={section.title} section={section} />)}

        <Typography variant="caption" color="text.disabled" display="block" textAlign="center" sx={{ mt: 6 }}>
          © {new Date().getFullYear()} {APP_NAME} · <Link component={RouterLink} to="/login" color="inherit">{backToLogin}</Link>
        </Typography>
      </Container>
    </Box>
  );
}
