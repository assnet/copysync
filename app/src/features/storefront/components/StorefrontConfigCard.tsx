import type { FormEvent, ReactNode } from 'react';
import {
  Alert, AlertTitle, Avatar, Box, Button, Card, CardContent, Divider, Stack, TextField, Typography,
} from '@mui/material';
import { Pencil, Settings2, Store } from 'lucide-react';
import { AppIcon } from '@/components';
import { Blurred, useBlur } from '@/features/privacy';
import type { StorefrontFormErrors, StorefrontFormState } from '../storefrontForm';
import { storefrontStrings } from '../strings';
import type { SlugAvailabilityStatus, StorefrontImageKind, StorefrontOverview } from '../types';
import { STOREFRONT_RANGES } from '../types';
import { CategoryChips } from './CategoryChips';
import { ColorField } from './ColorField';
import { ImagePicker } from './ImagePicker';
import { PremiumSlugBanner } from './PremiumSlugBanner';
import { SlugField } from './SlugField';
import { SubtitleField } from './SubtitleField';

const t = storefrontStrings;
const COLORS = [
  { field: 'colorPrimary', label: t.fields.colors.primary },
  { field: 'colorBackground', label: t.fields.colors.background },
  { field: 'colorCard', label: t.fields.colors.card },
] as const;

export interface StorefrontConfigCardProps {
  overview: StorefrontOverview;
  /** Rascunho (a página guarda em `usePersistedState`). */
  form: StorefrontFormState;
  onChange: <K extends keyof StorefrontFormState>(field: K, value: StorefrontFormState[K]) => void;
  /** Erros de `validateForm` que a página decidiu mostrar (ex.: após tentar salvar). */
  errors?: StorefrontFormErrors;
  editing: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  /** Checagem do nome (debounce e chamada ficam na página). */
  slug: { status: SlugAvailabilityStatus | null; checking: boolean; suggestions: string[] };
  /** `slugChange(form, overview)`: aviso de troca de endereço; null = sem troca. */
  slugChange: { from: string; to: string } | null;
  onImageUploaded: (kind: StorefrontImageKind, uploadId: string) => void | Promise<void>;
  onImageRemove: (kind: StorefrontImageKind) => void | Promise<void>;
  imageErrors?: Partial<Record<StorefrontImageKind, string | null>>;
}

function CardHeader({ action }: { action?: ReactNode }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2.5, py: 2 }}>
      <Box sx={{ color: 'primary.main', display: 'inline-flex' }}><AppIcon icon={Settings2} size="md" /></Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>{t.config.title}</Typography>
      {action}
    </Stack>
  );
}

/** Configuração da página: resumo (nome + endereço), convite para criar ou o formulário. */
export function StorefrontConfigCard(props: StorefrontConfigCardProps) {
  const { overview, form, onChange, errors = {}, editing, saving, onEdit, onCancel, onSave, slug, slugChange } = props;
  const page = overview.storefront;
  const blurName = useBlur('storefront.name');
  const blurAddress = useBlur('storefront.subdomain');
  const blurPhoto = useBlur('storefront.photo');

  if (!editing && !page) {
    return (
      <Card>
        <CardHeader />
        <Divider />
        <CardContent>
          <Stack spacing={1.5} alignItems="center" sx={{ textAlign: 'center', py: 3 }}>
            <Box sx={{ color: 'primary.main', display: 'inline-flex' }}><AppIcon icon={Store} size="lg" /></Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{t.empty.title}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480 }}>{t.empty.description}</Typography>
            <Button variant="contained" disableElevation onClick={onEdit} disabled={overview.domains.length === 0}>{t.empty.cta}</Button>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  if (!editing && page) {
    return (
      <Card>
        <CardHeader action={<Button variant="outlined" size="small" startIcon={<AppIcon icon={Pencil} />} onClick={onEdit}>{t.config.edit}</Button>} />
        <Divider />
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center">
            <Blurred when={blurPhoto} radius={10}>
              <Avatar src={page.avatarUrl ?? undefined} alt="" sx={{ width: 56, height: 56 }}>
                <AppIcon icon={Store} size="md" />
              </Avatar>
            </Blurred>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }} noWrap>
                <Blurred when={blurName} inline radius={5}>{page.title}</Blurred>
              </Typography>
              <Typography variant="caption" color="text.secondary" component="p">{t.config.addressLabel}</Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {overview.publicUrl
                  ? <Blurred when={blurAddress} inline radius={5}>{overview.publicUrl}</Blurred>
                  : <Box component="span" sx={{ color: 'warning.main' }}>{t.address.missing}</Box>}
              </Typography>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!saving) onSave();
  };

  return (
    <Card>
      <CardHeader />
      <Divider />
      <CardContent component="form" noValidate onSubmit={submit}>
        <Stack spacing={3}>
          <TextField
            fullWidth
            required
            label={t.fields.name.label}
            placeholder={t.fields.name.placeholder}
            value={form.title}
            disabled={saving}
            onChange={(e) => onChange('title', e.target.value.slice(0, STOREFRONT_RANGES.name.max))}
            error={Boolean(errors.title)}
            helperText={errors.title ?? t.fields.name.help}
            inputProps={{ maxLength: STOREFRONT_RANGES.name.max }}
            sx={blurName ? { '& .MuiInputBase-input': { filter: 'blur(5px)', userSelect: 'none' } } : undefined}
          />

          <Box>
            <SlugField
              value={form.slug}
              onChange={(v) => onChange('slug', v)}
              domainId={form.domainId}
              domains={overview.domains}
              onDomainChange={(v) => onChange('domainId', v)}
              status={slug.status}
              checking={slug.checking}
              suggestions={slug.suggestions}
              error={errors.slug}
              disabled={saving}
            />
            <PremiumSlugBanner open={!slug.checking && slug.status === 'PREMIUM'} />
          </Box>

          {page ? (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3}>
              <ImagePicker
                kind="avatar"
                imageUrl={page.avatarUrl}
                onUploaded={(id) => props.onImageUploaded('avatar', id)}
                onRemove={() => props.onImageRemove('avatar')}
                error={props.imageErrors?.avatar}
                disabled={saving}
              />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <ImagePicker
                  kind="cover"
                  imageUrl={page.coverUrl}
                  onUploaded={(id) => props.onImageUploaded('cover', id)}
                  onRemove={() => props.onImageRemove('cover')}
                  error={props.imageErrors?.cover}
                  disabled={saving}
                />
              </Box>
            </Stack>
          ) : (
            <Alert severity="info" variant="outlined">{t.fields.images.afterSave}</Alert>
          )}

          <SubtitleField
            value={form.subtitle}
            onChange={(v) => onChange('subtitle', v)}
            suggestions={overview.subtitleSuggestions}
            error={errors.subtitle}
            disabled={saving}
          />

          <CategoryChips
            categories={overview.categories}
            value={form.categories}
            onChange={(v) => onChange('categories', v)}
            disabled={saving}
          />

          <Box role="group" aria-label={t.fields.colors.label}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 0.4 }}>{t.fields.colors.label}</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 1 }}>
              {COLORS.map((c) => (
                <ColorField key={c.field} label={c.label} value={form[c.field]} onChange={(v) => onChange(c.field, v)} disabled={saving} />
              ))}
            </Stack>
          </Box>

          {slugChange && (
            <Alert severity="warning" role="alert">
              <AlertTitle>{t.config.changeTitle}</AlertTitle>
              <Blurred when={blurAddress} inline radius={5}>{t.fields.subdomain.changeWarning(slugChange.from, slugChange.to)}</Blurred>
            </Alert>
          )}

          <Stack direction="row" spacing={1.5} justifyContent="flex-end">
            <Button color="inherit" onClick={onCancel} disabled={saving}>{t.config.cancel}</Button>
            <Button type="submit" variant="contained" disableElevation disabled={saving}>
              {saving ? t.config.saving : page ? t.config.save : t.config.create}
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
