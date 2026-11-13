import { Alert, Box, Button, Skeleton, Snackbar, Stack } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { RotateCw } from 'lucide-react';
import { AppIcon } from '@/components';
import { AddOfferCard } from './components/AddOfferCard';
import { DeleteStorefrontDialog } from './components/DeleteStorefrontDialog';
import { EditOfferDialog } from './components/EditOfferDialog';
import { OfferTabs } from './components/OfferTabs';
import { StorefrontDangerZone } from './components/StorefrontDangerZone';
import { StorefrontConfigCard } from './components/StorefrontConfigCard';
import { StorefrontHeader } from './components/StorefrontHeader';
import { StorefrontPreview } from './components/StorefrontPreview';
import { useStorefrontPage } from './hooks/useStorefrontPage';
import { storefrontUpgradePath } from './planGate';
import { previewRevision } from './storefrontForm';
import { storefrontStrings } from './strings';

const t = storefrontStrings;

/** Celular: config → prévia → ofertas. md+: duas colunas, prévia fixa à direita. */
const GRID = {
  display: 'grid',
  gap: 3,
  alignItems: 'start',
  gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 420px)' },
  gridTemplateAreas: { xs: '"config" "preview" "offers"', md: '"config preview" "offers preview"' },
} as const;

function LoadingSkeleton() {
  return (
    <Box sx={GRID}>
      <Skeleton variant="rounded" height={220} sx={{ gridArea: 'config' }} />
      <Skeleton variant="rounded" height={560} sx={{ gridArea: 'preview' }} />
      <Skeleton variant="rounded" height={320} sx={{ gridArea: 'offers' }} />
    </Box>
  );
}

/** Página de Ofertas do tenant: estado e chamadas em `useStorefrontPage`; aqui só a composição. */
export function StorefrontPage() {
  const s = useStorefrontPage();
  const { overview } = s;
  const page = overview?.storefront ?? null;
  const onCopyFailed = () => s.notify(t.address.copyFailed, 'error');
  const dangerZone = page && overview?.canDelete === true && <StorefrontDangerZone onDelete={s.openDelete} />;
  const deleteDialog = overview && (
    <DeleteStorefrontDialog
      open={s.deleteOpen && page !== null}
      address={overview.publicUrl?.replace(/^https?:\/\//, '') ?? page?.slug ?? null}
      // `planLocked`: as listas vêm vazias e o total chega em `offersCount`
      offerCount={page?.offersCount ?? overview.offers.drafts.length + overview.offers.published.length}
      lockedUntil={s.deleteLockedUntil}
      onClose={s.closeDelete}
      onConfirm={s.deletePage}
    />
  );

  return (
    <Box>
      <StorefrontHeader publicUrl={overview?.publicUrl ?? null} onCopyFailed={onCopyFailed} />

      {s.loading && !overview ? (
        <LoadingSkeleton />
      ) : s.failed || !overview ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" startIcon={<AppIcon icon={RotateCw} size="sm" />} onClick={() => void s.reload()}>
              {t.page.retry}
            </Button>
          }
        >
          {t.page.loadError}
        </Alert>
      ) : overview.planLocked ? (
        // Plano sem a página, mas ela existe: só o aviso com o caminho do upgrade e a exclusão.
        <Stack spacing={3}>
          <Alert
            severity="warning"
            action={<Button component={RouterLink} to={storefrontUpgradePath} color="inherit" size="small">{t.page.seePlans}</Button>}
          >
            {t.page.paused}
          </Alert>
          {dangerZone}
          {deleteDialog}
        </Stack>
      ) : (
        <Stack spacing={3}>
          {page?.status === 'PAUSED_BY_PLAN' && <Alert severity="warning">{t.page.paused}</Alert>}
          {!page && overview.domains.length === 0 && <Alert severity="info">{t.page.noDomain}</Alert>}

          <Box sx={GRID}>
            <Box sx={{ gridArea: 'config', minWidth: 0 }}>
              <StorefrontConfigCard
                overview={overview}
                form={s.form}
                onChange={s.changeField}
                errors={s.errors}
                editing={s.editing}
                saving={s.saving}
                onEdit={s.startEdit}
                onCancel={s.cancelEdit}
                onSave={() => void s.save()}
                slug={s.slugCheck}
                slugChange={s.slugChange}
                onImageUploaded={s.uploadImage}
                onImageRemove={s.removeImage}
                imageErrors={s.imageErrors}
                onCopyFailed={onCopyFailed}
              />
            </Box>

            <Box sx={{ gridArea: 'preview', minWidth: 0, position: { md: 'sticky' }, top: { md: 88 } }}>
              <StorefrontPreview draft={s.form} viewport={s.viewport} onViewportChange={s.setViewport} revision={previewRevision(s.overview)} />
            </Box>

            <Stack spacing={3} sx={{ gridArea: 'offers', minWidth: 0 }}>
              <AddOfferCard
                value={s.addDraft}
                onChange={s.editAddDraft}
                categories={overview.categories}
                selectedCategories={page?.categories ?? []}
                onExtract={s.extract}
                error={s.addError}
                errorAction={s.addErrorAction}
                errorCode={s.addErrorSource?.code}
                errorMeta={s.addErrorSource?.meta}
                rebuiltProvider={s.addRebuiltProvider}
                disabled={!page}
              />
              {page && (
                <OfferTabs
                  drafts={overview.offers.drafts}
                  published={overview.offers.published}
                  tab={s.tab}
                  onTabChange={s.setTab}
                  categories={overview.categories}
                  onReorder={s.reorder}
                  onToggleStatus={s.toggleStatus}
                  onEdit={s.openEditOffer}
                  onDelete={s.deleteOffer}
                />
              )}
            </Stack>
          </Box>

          {dangerZone}
          {deleteDialog}

          <EditOfferDialog
            offer={s.editingOffer}
            categories={overview.categories}
            selectedCategories={page?.categories ?? []}
            onClose={s.closeEditOffer}
            onSave={s.saveOffer}
          />
        </Stack>
      )}

      <Snackbar
        open={s.toast !== null}
        autoHideDuration={4000}
        onClose={(_, reason) => { if (reason !== 'clickaway') s.closeToast(); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {s.toast ? (
          <Alert severity={s.toast.severity} variant="filled" onClose={s.closeToast} sx={{ width: '100%' }}>{s.toast.message}</Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
