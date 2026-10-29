import { useMemo } from 'react';
import { Box, Stack, Tab, Tabs } from '@mui/material';
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors,
  type Announcements, type DragEndEvent, type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Inbox, Store } from 'lucide-react';
import { AppIcon, EmptyState, SectionCard } from '@/components';
import { storefrontStrings } from '../strings';
import type { StorefrontCategory, StorefrontOffer, StorefrontOfferStatus } from '../types';
import { canMove, moveById, tabIds, tabStatus, type MoveDirection, type StorefrontOfferTab } from '../reorder';
import { categoryLabel } from '../offerForm';
import { OfferRow, type OfferRowProps } from './OfferRow';

const t = storefrontStrings.offers;

export interface OfferTabsProps {
  drafts: readonly StorefrontOffer[];
  published: readonly StorefrontOffer[];
  /** Controlado: a página persiste a aba ativa. */
  tab: StorefrontOfferTab;
  onTabChange: (tab: StorefrontOfferTab) => void;
  /** Catálogo de categorias (rótulos). */
  categories: readonly StorefrontCategory[];
  /**
   * Nova ordem da aba inteira (`PUT /storefront/offers/order`). A página aplica a ordem na lista na
   * hora (otimista) e recarrega se a API recusar.
   */
  onReorder: (status: StorefrontOfferStatus, ids: string[]) => void | Promise<void>;
  onToggleStatus: (offer: StorefrontOffer) => Promise<void>;
  onEdit: (offer: StorefrontOffer) => void;
  onDelete: (offer: StorefrontOffer) => Promise<void>;
}

type RowProps = Omit<OfferRowProps, 'drag'>;

function SortableOfferRow(props: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: props.offer.id });
  return (
    <OfferRow
      {...props}
      drag={{
        setNodeRef,
        setHandleRef: setActivatorNodeRef,
        handleProps: { ...attributes, ...listeners },
        style: { transform: CSS.Transform.toString(transform), transition },
        dragging: isDragging,
      }}
    />
  );
}

/** "Suas Ofertas": abas Rascunhos/Publicadas com contador e lista ordenável (arrastar ou ▲▼). */
export function OfferTabs({ drafts, published, tab, onTabChange, categories, onReorder, onToggleStatus, onEdit, onDelete }: OfferTabsProps) {
  const list = tab === 'drafts' ? drafts : published;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reorder = (id: string, target: MoveDirection | string) => {
    const next = moveById(list, id, target);
    if (next !== list) void onReorder(tabStatus(tab), tabIds(next));
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) reorder(String(active.id), String(over.id));
  };

  const position = (id: UniqueIdentifier) => list.findIndex((o) => o.id === id) + 1;
  const announcements = useMemo<Announcements>(() => ({
    onDragStart: ({ active }) => t.dnd.start(position(active.id)),
    onDragOver: ({ over }) => (over ? t.dnd.over(position(over.id)) : undefined),
    onDragEnd: ({ over }) => (over ? t.dnd.end(position(over.id)) : t.dnd.cancel),
    onDragCancel: () => t.dnd.cancel,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [list]);

  const empty = tab === 'drafts' ? t.emptyDrafts : t.emptyPublished;

  return (
    <SectionCard title={t.title} noPadding>
      <Tabs
        value={tab}
        onChange={(_, v: StorefrontOfferTab) => onTabChange(v)}
        variant="fullWidth"
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="drafts" label={t.tabs.drafts(drafts.length)} id="offers-tab-drafts" aria-controls="offers-panel" />
        <Tab value="published" label={t.tabs.published(published.length)} id="offers-tab-published" aria-controls="offers-panel" />
      </Tabs>
      <Box id="offers-panel" role="tabpanel" aria-labelledby={`offers-tab-${tab}`} sx={{ p: 2 }}>
        {list.length === 0 ? (
          <EmptyState
            icon={<AppIcon icon={tab === 'drafts' ? Inbox : Store} size="lg" />}
            title={empty.title}
            description={empty.description}
            sx={{ py: 5 }}
          />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
            accessibility={{ announcements, screenReaderInstructions: { draggable: t.dnd.instructions } }}
          >
            <SortableContext items={tabIds(list)} strategy={verticalListSortingStrategy}>
              <Stack spacing={1} component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {list.map((offer) => (
                  <li key={offer.id}>
                    <SortableOfferRow
                      offer={offer}
                      categoryLabel={categoryLabel(categories, offer.category)}
                      canMoveUp={canMove(list, offer.id, 'up')}
                      canMoveDown={canMove(list, offer.id, 'down')}
                      onMove={(dir) => reorder(offer.id, dir)}
                      onToggleStatus={() => onToggleStatus(offer)}
                      onEdit={() => onEdit(offer)}
                      onDelete={() => onDelete(offer)}
                    />
                  </li>
                ))}
              </Stack>
            </SortableContext>
          </DndContext>
        )}
      </Box>
    </SectionCard>
  );
}
