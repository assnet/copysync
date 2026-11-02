import { useEffect } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Container, Link, Typography, IconButton, Tooltip } from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import { useColorMode } from '@/contexts/ThemeContext';
import { APP_NAME } from '@/shared/branding/brand';
import { BrandLogo } from '@/shared/branding/BrandLogo';
import { privacyPolicyStrings as s, type PolicySection } from '@/features/privacy-policy/strings';

const brand = (text: string) => text.split('{{app}}').join(APP_NAME);

/** `**prefixo:** resto` → prefixo em negrito; e-mail/URL do contato viram link. */
function RichText({ text }: { text: string }) {
  const m = /^\*\*(.+?)\*\*\s*(.*)$/s.exec(text);
  const [bold, rest] = m ? [m[1], m[2]] : [null, text];
  const linkify = (t: string) => {
    if (/^https?:\/\/\S+$/.test(t)) return <Link href={t} target="_blank" rel="noopener noreferrer">{t}</Link>;
    if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(t)) return <Link href={`mailto:${t}`}>{t}</Link>;
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

function Section({ section }: { section: PolicySection }) {
  return (
    <Box component="section" sx={{ mt: 4, pt: 2, borderTop: 1, borderColor: 'divider' }}>
      <Typography component="h2" variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>
        {section.title}
      </Typography>
      <Paragraphs items={section.intro} />
      {section.blocks?.map((b, i) => (
        <Box key={b.subtitle ?? i}>
          {b.subtitle && (
            <Typography component="h3" variant="subtitle1" fontWeight={600} sx={{ mt: 2, mb: 0.75 }}>
              {b.subtitle}
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

/**
 * Página pública (sem login) da Política de Privacidade. É a URL declarada na Chrome Web Store;
 * precisa responder sem autenticação. Texto em `features/privacy-policy/strings.ts`.
 */
export function PrivacyPolicyPage() {
  const { mode, toggleColorMode } = useColorMode();

  useEffect(() => {
    const prev = document.title;
    document.title = `${s.pageTitle} · ${APP_NAME}`;
    return () => { document.title = prev; };
  }, []);

  return (
    <Box component="main" sx={{ minHeight: '100vh', bgcolor: 'background.default', color: 'text.primary' }}>
      <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 4 }}>
          <Link component={RouterLink} to="/login" underline="none" color="inherit" sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <BrandLogo size={36} />
            <Typography fontWeight={700}>{APP_NAME}</Typography>
          </Link>
          <Tooltip title={mode === 'dark' ? 'Tema claro' : 'Tema escuro'}>
            <IconButton size="small" onClick={toggleColorMode} aria-label={mode === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}>
              {mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Box>

        <Typography component="h1" variant="h4" fontWeight={800} sx={{ letterSpacing: -0.5, mb: 0.5 }}>
          {brand(s.title)}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>{s.updatedAt}</Typography>

        <Paragraphs items={s.intro} />
        {s.sections.map((section) => <Section key={section.title} section={section} />)}

        <Typography variant="caption" color="text.disabled" display="block" textAlign="center" sx={{ mt: 6 }}>
          © {new Date().getFullYear()} {APP_NAME} · <Link component={RouterLink} to="/login" color="inherit">{s.backToLogin}</Link>
        </Typography>
      </Container>
    </Box>
  );
}
