import React, { useState, useEffect } from 'react';
import { oledTheme, FONT_MONO } from '../../theme';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { TrashIcon, RefreshIcon, FilmIcon } from '../../components/Icons';
import { ConfirmModal } from '../../components/ConfirmModal';
import {
  api,
  type ContinueWatchingViewItem,
  type FavoriteViewItem,
  type WatchHistoryViewItem,
} from '../../api';

type LibraryTab = 'continue_watching' | 'favorites' | 'history';

interface LibraryViewProps {
  activeProfileId: string | null;
}

export const LibraryView: React.FC<LibraryViewProps> = ({ activeProfileId }) => {
  const [tab, setTab] = useState<LibraryTab>('continue_watching');
  const [continueWatching, setContinueWatching] = useState<ContinueWatchingViewItem[]>([]);
  const [favorites, setFavorites] = useState<FavoriteViewItem[]>([]);
  const [watchHistory, setWatchHistory] = useState<WatchHistoryViewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    submessage?: string;
    onConfirm: () => Promise<void> | void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const fetchLibrary = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.pullLibrary(0, activeProfileId || undefined);
      setContinueWatching(data.deltas.continueWatching || []);
      setFavorites(data.deltas.favorites || []);
      setWatchHistory(data.deltas.watchHistory || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch library.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLibrary();
  }, [activeProfileId]);

  const promptDeleteItem = (
    type: 'continue_watching' | 'favorite' | 'watch_history',
    key: string,
    label: string
  ) => {
    const typeLabel =
      type === 'continue_watching'
        ? 'Continua a guardare'
        : type === 'favorite'
        ? 'Preferito'
        : 'Cronologia visione';

    setConfirmModal({
      isOpen: true,
      title: 'ELIMINA ELEMENTO',
      message: `Sei sicuro di voler eliminare "${label}"?`,
      submessage: `Questo elemento verrà rimosso da ${typeLabel} per il profilo attivo.`,
      onConfirm: async () => {
        setDeletingKey(key);
        setError(null);
        try {
          await api.deleteLibraryItem(type, key, activeProfileId || undefined);
          if (type === 'continue_watching') {
            setContinueWatching((prev) => prev.filter((item) => item.animeId !== key));
          } else if (type === 'favorite') {
            setFavorites((prev) => prev.filter((item) => item.id !== key));
          } else if (type === 'watch_history') {
            const [animeId, epStr] = key.split(':');
            const ep = parseInt(epStr, 10);
            setWatchHistory((prev) =>
              prev.filter((item) => !(item.animeId === animeId && item.episodeNumber === ep))
            );
          }
          setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        } catch (err: any) {
          setError(`Impossibile eliminare l'elemento: ${err?.message || 'Errore sconosciuto'}`);
        } finally {
          setDeletingKey(null);
        }
      },
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Top Header & Tab Switcher */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          borderBottom: `1px solid ${oledTheme.colors.border}`,
          paddingBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setTab('continue_watching')}
            style={{
              padding: '8px 16px',
              fontFamily: FONT_MONO,
              fontSize: '13px',
              fontWeight: 700,
              textTransform: 'uppercase',
              borderRadius: oledTheme.radius.sm,
              border: `1px solid ${
                tab === 'continue_watching' ? oledTheme.colors.primary : oledTheme.colors.border
              }`,
              backgroundColor:
                tab === 'continue_watching' ? 'rgba(229, 9, 20, 0.15)' : '#0D0D0D',
              color: tab === 'continue_watching' ? '#FFFFFF' : oledTheme.colors.textSecondary,
              cursor: 'pointer',
            }}
          >
            CONTINUE WATCHING ({continueWatching.length})
          </button>
          <button
            onClick={() => setTab('favorites')}
            style={{
              padding: '8px 16px',
              fontFamily: FONT_MONO,
              fontSize: '13px',
              fontWeight: 700,
              textTransform: 'uppercase',
              borderRadius: oledTheme.radius.sm,
              border: `1px solid ${
                tab === 'favorites' ? oledTheme.colors.primary : oledTheme.colors.border
              }`,
              backgroundColor: tab === 'favorites' ? 'rgba(229, 9, 20, 0.15)' : '#0D0D0D',
              color: tab === 'favorites' ? '#FFFFFF' : oledTheme.colors.textSecondary,
              cursor: 'pointer',
            }}
          >
            FAVORITES ({favorites.length})
          </button>
          <button
            onClick={() => setTab('history')}
            style={{
              padding: '8px 16px',
              fontFamily: FONT_MONO,
              fontSize: '13px',
              fontWeight: 700,
              textTransform: 'uppercase',
              borderRadius: oledTheme.radius.sm,
              border: `1px solid ${
                tab === 'history' ? oledTheme.colors.primary : oledTheme.colors.border
              }`,
              backgroundColor: tab === 'history' ? 'rgba(229, 9, 20, 0.15)' : '#0D0D0D',
              color: tab === 'history' ? '#FFFFFF' : oledTheme.colors.textSecondary,
              cursor: 'pointer',
            }}
          >
            WATCH HISTORY ({watchHistory.length})
          </button>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={fetchLibrary}
          loading={loading}
          icon={<RefreshIcon size={14} />}
        >
          REFRESH
        </Button>
      </div>

      {error && (
        <div
          style={{
            padding: '12px 14px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid #EF4444',
            borderRadius: oledTheme.radius.sm,
            color: '#EF4444',
            fontSize: '13px',
            fontFamily: FONT_MONO,
          }}
        >
          {error}
        </div>
      )}

      {/* Tab 1: Continue Watching */}
      {tab === 'continue_watching' && (
        <div>
          {continueWatching.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '60px 20px',
                color: oledTheme.colors.textMuted,
                fontFamily: FONT_MONO,
                fontSize: '12px',
                textTransform: 'uppercase',
              }}
            >
              NESSUN ELEMENTO IN CONTINUA A GUARDARE
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: '16px',
              }}
            >
              {continueWatching.map((item) => {
                const isCaughtUp =
                  item.isCaughtUp === true ||
                  (item.totalEpisodes !== undefined &&
                    item.totalEpisodes > 0 &&
                    item.episodeNumber >= item.totalEpisodes);

                return (
                  <Card
                    key={item.animeId}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      padding: 0,
                      overflow: 'hidden',
                      position: 'relative',
                    }}
                  >
                    {/* Thumbnail & Badges */}
                    <div
                      style={{
                        position: 'relative',
                        width: '100%',
                        height: '140px',
                        backgroundColor: '#171717',
                        overflow: 'hidden',
                      }}
                    >
                      {item.thumbnail ? (
                        <img
                          src={item.thumbnail}
                          alt={item.title}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: '100%',
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: oledTheme.colors.textMuted,
                          }}
                        >
                          <FilmIcon size={32} />
                        </div>
                      )}

                      {/* [IN PARI] Badge */}
                      {isCaughtUp && (
                        <div style={{ position: 'absolute', top: '8px', left: '8px' }}>
                          <Badge variant="in-pari">IN PARI</Badge>
                        </div>
                      )}

                      {/* Episode Badge */}
                      <div style={{ position: 'absolute', bottom: '8px', right: '8px' }}>
                        <span
                          style={{
                            backgroundColor: 'rgba(0, 0, 0, 0.85)',
                            color: '#FFFFFF',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontFamily: FONT_MONO,
                            fontWeight: 700,
                          }}
                        >
                          EP {item.episodeNumber}
                          {item.totalEpisodes ? ` / ${item.totalEpisodes}` : ''}
                        </span>
                      </div>

                      {/* Progress bar overlay */}
                      <div
                        style={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          height: '4px',
                          backgroundColor: 'rgba(255, 255, 255, 0.2)',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${Math.min(100, Math.max(0, item.percentage || 0))}%`,
                            backgroundColor: oledTheme.colors.primary,
                          }}
                        />
                      </div>
                    </div>

                    {/* Content Details */}
                    <div
                      style={{
                        padding: '12px 14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        flex: 1,
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <h3
                          style={{
                            fontSize: '14px',
                            fontFamily: FONT_MONO,
                            fontWeight: 700,
                            color: '#FFFFFF',
                            margin: '0 0 4px 0',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={item.title}
                        >
                          {item.title}
                        </h3>
                        <div
                          style={{
                            fontSize: '11px',
                            color: oledTheme.colors.textMuted,
                            fontFamily: FONT_MONO,
                          }}
                        >
                          {item.percentage ? `${Math.round(item.percentage)}% watched` : 'In progress'}
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'flex-end',
                          alignItems: 'center',
                          borderTop: `1px solid ${oledTheme.colors.border}`,
                          paddingTop: '8px',
                        }}
                      >
                        <Button
                          variant="danger"
                          size="sm"
                          loading={deletingKey === item.animeId}
                          onClick={() => promptDeleteItem('continue_watching', item.animeId, item.title)}
                          icon={<TrashIcon size={12} />}
                        >
                          DELETE
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Favorites */}
      {tab === 'favorites' && (
        <div>
          {favorites.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '60px 20px',
                color: oledTheme.colors.textMuted,
                fontFamily: FONT_MONO,
                fontSize: '12px',
                textTransform: 'uppercase',
              }}
            >
              NESSUN ANIME NEI PREFERITI
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: '16px',
              }}
            >
              {favorites.map((fav) => (
                <Card
                  key={fav.id}
                  style={{
                    padding: 0,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div
                    style={{
                      height: '240px',
                      backgroundColor: '#171717',
                      overflow: 'hidden',
                      position: 'relative',
                    }}
                  >
                    {fav.thumbnail ? (
                      <img
                        src={fav.thumbnail}
                        alt={fav.title}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: oledTheme.colors.textMuted,
                        }}
                      >
                        <FilmIcon size={40} />
                      </div>
                    )}
                    {fav.status && (
                      <div style={{ position: 'absolute', top: '8px', left: '8px' }}>
                        <Badge variant="accent">{fav.status}</Badge>
                      </div>
                    )}
                  </div>
                  <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                      <h3
                        style={{
                          fontSize: '14px',
                          fontFamily: FONT_MONO,
                          fontWeight: 700,
                          color: '#FFFFFF',
                          margin: '0 0 4px 0',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={fav.title}
                      >
                        {fav.title}
                      </h3>
                      <div
                        style={{
                          fontSize: '11px',
                          color: oledTheme.colors.textMuted,
                          fontFamily: FONT_MONO,
                        }}
                      >
                        {fav.releaseYear || fav.type || 'Anime'}
                      </div>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'flex-end',
                        marginTop: '10px',
                        borderTop: `1px solid ${oledTheme.colors.border}`,
                        paddingTop: '8px',
                      }}
                    >
                      <Button
                        variant="danger"
                        size="sm"
                        loading={deletingKey === fav.id}
                        onClick={() => promptDeleteItem('favorite', fav.id, fav.title)}
                        icon={<TrashIcon size={12} />}
                      >
                        DELETE
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Watch History */}
      {tab === 'history' && (
        <div>
          {watchHistory.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '60px 20px',
                color: oledTheme.colors.textMuted,
                fontFamily: FONT_MONO,
                fontSize: '12px',
                textTransform: 'uppercase',
              }}
            >
              CRONOLOGIA DI VISIONE VUOTA
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {watchHistory.map((item) => {
                const itemKey = `${item.animeId}:${item.episodeNumber}`;
                return (
                  <div
                    key={itemKey}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      backgroundColor: oledTheme.colors.card,
                      border: `1px solid ${oledTheme.colors.border}`,
                      borderRadius: oledTheme.radius.sm,
                      fontFamily: FONT_MONO,
                      fontSize: '13px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
                      <span
                        style={{
                          backgroundColor: '#1E1E1E',
                          color: oledTheme.colors.textSecondary,
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontWeight: 700,
                          fontSize: '11px',
                        }}
                      >
                        EP {item.episodeNumber}
                      </span>
                      <span
                        style={{
                          color: '#FFFFFF',
                          fontWeight: 600,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={item.title}
                      >
                        {item.title}
                      </span>
                      {item.isCompleted && <Badge variant="success">COMPLETED</Badge>}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ color: oledTheme.colors.textMuted, fontSize: '11px' }}>
                        {item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : ''}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={deletingKey === itemKey}
                        onClick={() =>
                          promptDeleteItem(
                            'watch_history',
                            itemKey,
                            `${item.title} (EP ${item.episodeNumber})`
                          )
                        }
                        icon={<TrashIcon size={14} color="#EF4444" />}
                        title="Delete record"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        submessage={confirmModal.submessage}
        confirmLabel="ELIMINA"
        variant="danger"
        loading={!!deletingKey}
        onConfirm={confirmModal.onConfirm}
        onClose={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};
