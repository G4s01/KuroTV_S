import React, { useState } from 'react';
import { oledTheme, FONT_MONO } from '../../theme';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { ConfirmModal } from '../../components/ConfirmModal';
import { PlusIcon, TrashIcon, UserIcon, CheckIcon, EditIcon } from '../../components/Icons';
import { api, type ProfileRecord } from '../../api';

const AVATAR_COLORS = [
  '#E50914',
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
  '#64748B',
];

interface ProfilesViewProps {
  profiles: ProfileRecord[];
  activeProfileId: string | null;
  onRefreshProfiles: () => Promise<void>;
  onSelectProfile: (id: string) => void;
}

export const ProfilesView: React.FC<ProfilesViewProps> = ({
  profiles,
  activeProfileId,
  onRefreshProfiles,
  onSelectProfile,
}) => {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileColor, setNewProfileColor] = useState('#E50914');
  const [creating, setCreating] = useState(false);

  // Edit / Rename Profile state
  const [editingProfile, setEditingProfile] = useState<ProfileRecord | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#E50914');
  const [savingEdit, setSavingEdit] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    submessage?: string;
    confirmLabel: string;
    action: () => Promise<void>;
  }>({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'ELIMINA',
    action: async () => {},
  });

  const handleCreateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileName.trim()) return;

    setCreating(true);
    setError(null);
    try {
      const res = await api.createProfile(newProfileName.trim(), newProfileColor);
      await onRefreshProfiles();
      setIsCreateModalOpen(false);
      setNewProfileName('');
      if (res?.profile?.id) {
        onSelectProfile(res.profile.id);
      }
    } catch (err: any) {
      setError(err?.message || 'Impossibile creare il profilo.');
    } finally {
      setCreating(false);
    }
  };

  const handleOpenEdit = (p: ProfileRecord) => {
    setEditingProfile(p);
    setEditName(p.name);
    setEditColor(p.avatarColor || p.avatar_color || '#E50914');
    setError(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProfile || !editName.trim()) return;

    setSavingEdit(true);
    setError(null);
    try {
      await api.updateProfile(editingProfile.id, {
        name: editName.trim(),
        avatarColor: editColor,
      });
      await onRefreshProfiles();
      setEditingProfile(null);
    } catch (err: any) {
      setError(err?.message || 'Impossibile aggiornare il profilo.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteProfile = (id: string, name: string) => {
    if (profiles.length <= 1) {
      setError('Impossibile eliminare l\'unico profilo presente su questa istanza.');
      return;
    }

    setConfirmModal({
      isOpen: true,
      title: 'ELIMINA PROFILO',
      message: `Vuoi eliminare definitivamente il profilo "${name}"?`,
      submessage: 'Tutti i dati associati (Continua a guardare, Preferiti, Cronologia e Impostazioni) per questo profilo verranno rimossi permanentemente.',
      confirmLabel: 'ELIMINA PROFILO',
      action: async () => {
        setDeletingId(id);
        try {
          await api.deleteProfile(id);
          await onRefreshProfiles();
          if (activeProfileId === id) {
            const remaining = profiles.filter((p) => p.id !== id);
            if (remaining[0]) {
              onSelectProfile(remaining[0].id);
            }
          }
        } catch (err: any) {
          setError(`Errore durante l'eliminazione: ${err?.message || 'Errore sconosciuto'}`);
        } finally {
          setDeletingId(null);
          setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        }
      },
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
        <div>
          <h2
            style={{
              fontFamily: FONT_MONO,
              fontSize: '18px',
              fontWeight: 700,
              color: '#FFFFFF',
              margin: '0 0 4px 0',
              textTransform: 'uppercase',
            }}
          >
            PROFILI ({profiles.length})
          </h2>
          <p
            style={{
              fontFamily: FONT_MONO,
              fontSize: '11px',
              color: oledTheme.colors.textMuted,
              margin: 0,
              textTransform: 'uppercase',
            }}
          >
            PROFILI DI VISIONE INDIPENDENTI
          </p>
        </div>

        <Button
          variant="primary"
          size="sm"
          onClick={() => setIsCreateModalOpen(true)}
          icon={<PlusIcon size={14} />}
        >
          NUOVO PROFILO
        </Button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '16px',
        }}
      >
        {profiles.map((p) => {
          const isActive = p.id === activeProfileId;
          const color = p.avatarColor || p.avatar_color || '#E50914';

          return (
            <Card
              key={p.id}
              style={{
                border: `1px solid ${isActive ? oledTheme.colors.borderActive : oledTheme.colors.border}`,
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                position: 'relative',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    backgroundColor: color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#FFFFFF',
                    fontWeight: 700,
                    fontSize: '18px',
                    fontFamily: FONT_MONO,
                    boxShadow: isActive ? `0 0 12px ${color}66` : 'none',
                  }}
                >
                  {p.name.charAt(0).toUpperCase()}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3
                      style={{
                        margin: 0,
                        fontSize: '16px',
                        fontFamily: FONT_MONO,
                        fontWeight: 700,
                        color: '#FFFFFF',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.name}
                    </h3>
                    {isActive && (
                      <span
                        style={{
                          fontSize: '10px',
                          color: '#10B981',
                          backgroundColor: 'rgba(16, 185, 129, 0.15)',
                          border: '1px solid #10B981',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          fontFamily: FONT_MONO,
                          fontWeight: 700,
                        }}
                      >
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: oledTheme.colors.textMuted,
                      fontFamily: FONT_MONO,
                      marginTop: '4px',
                    }}
                  >
                    Created: {new Date(p.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderTop: `1px solid ${oledTheme.colors.border}`,
                  paddingTop: '12px',
                }}
              >
                {!isActive ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onSelectProfile(p.id)}
                  >
                    ATTIVA
                  </Button>
                ) : (
                  <span
                    style={{
                      fontSize: '11px',
                      fontFamily: FONT_MONO,
                      color: oledTheme.colors.textMuted,
                      fontWeight: 700,
                    }}
                  >
                    PROFILO ATTIVO
                  </span>
                )}

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleOpenEdit(p)}
                    icon={<EditIcon size={12} />}
                    title="MODIFICA PROFILO"
                  >
                    MODIFICA
                  </Button>

                  {profiles.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={deletingId === p.id}
                      onClick={() => handleDeleteProfile(p.id, p.name)}
                      icon={<TrashIcon size={14} color="#EF4444" />}
                      title="ELIMINA PROFILO"
                    />
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Create Profile Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="CREA NUOVO PROFILO"
      >
        <form onSubmit={handleCreateProfile} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {error && (
            <div
              style={{
                padding: '10px 12px',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid #EF4444',
                borderRadius: oledTheme.radius.sm,
                color: '#EF4444',
                fontSize: '12px',
                fontFamily: FONT_MONO,
                textTransform: 'uppercase',
              }}
            >
              {error}
            </div>
          )}

          <div>
            <label
              style={{
                display: 'block',
                fontFamily: FONT_MONO,
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                color: oledTheme.colors.textSecondary,
                marginBottom: '8px',
              }}
            >
              NOME PROFILO
            </label>
            <input
              type="text"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              placeholder="ES. SALOTTO TV, MARCO"
              required
              autoFocus
              style={{
                width: '100%',
                padding: '10px 14px',
                backgroundColor: '#050505',
                border: `1px solid ${oledTheme.colors.border}`,
                borderRadius: oledTheme.radius.sm,
                color: '#FFFFFF',
                fontFamily: FONT_MONO,
                fontSize: '13px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontFamily: FONT_MONO,
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                color: oledTheme.colors.textSecondary,
                marginBottom: '8px',
              }}
            >
              COLORE AVATAR
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewProfileColor(c)}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: c,
                    border: newProfileColor === c ? '2px solid #FFFFFF' : '2px solid transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    outline: 'none',
                  }}
                >
                  {newProfileColor === c && <CheckIcon size={16} color="#FFFFFF" />}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsCreateModalOpen(false)}
              style={{ flex: 1 }}
            >
              ANNULLA
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={creating}
              style={{ flex: 1 }}
            >
              CREA
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Profile Modal */}
      <Modal
        isOpen={!!editingProfile}
        onClose={() => setEditingProfile(null)}
        title="MODIFICA PROFILO"
      >
        <form onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {error && (
            <div
              style={{
                padding: '10px 12px',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid #EF4444',
                borderRadius: oledTheme.radius.sm,
                color: '#EF4444',
                fontSize: '12px',
                fontFamily: FONT_MONO,
                textTransform: 'uppercase',
              }}
            >
              {error}
            </div>
          )}

          <div>
            <label
              style={{
                display: 'block',
                fontFamily: FONT_MONO,
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                color: oledTheme.colors.textSecondary,
                marginBottom: '8px',
              }}
            >
              NOME PROFILO
            </label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="NOME DEL PROFILO"
              required
              autoFocus
              style={{
                width: '100%',
                padding: '10px 14px',
                backgroundColor: '#050505',
                border: `1px solid ${oledTheme.colors.border}`,
                borderRadius: oledTheme.radius.sm,
                color: '#FFFFFF',
                fontFamily: FONT_MONO,
                fontSize: '13px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontFamily: FONT_MONO,
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                color: oledTheme.colors.textSecondary,
                marginBottom: '8px',
              }}
            >
              COLORE AVATAR
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setEditColor(c)}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: c,
                    border: editColor === c ? '2px solid #FFFFFF' : '2px solid transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    outline: 'none',
                  }}
                >
                  {editColor === c && <CheckIcon size={16} color="#FFFFFF" />}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditingProfile(null)}
              style={{ flex: 1 }}
            >
              ANNULLA
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={savingEdit}
              style={{ flex: 1 }}
            >
              SALVA MODIFICHE
            </Button>
          </div>
        </form>
      </Modal>

      {/* Integrated In-UI Confirmation Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={confirmModal.action}
        title={confirmModal.title}
        message={confirmModal.message}
        submessage={confirmModal.submessage}
        confirmLabel={confirmModal.confirmLabel}
      />
    </div>
  );
};
