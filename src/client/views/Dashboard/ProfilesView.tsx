import React, { useState } from 'react';
import { oledTheme, FONT_MONO } from '../../theme';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { ConfirmModal } from '../../components/ConfirmModal';
import { PlusIcon, TrashIcon, UserIcon, CheckIcon } from '../../components/Icons';
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
            Profiles ({profiles.length})
          </h2>
          <p
            style={{
              fontFamily: FONT_MONO,
              fontSize: '12px',
              color: oledTheme.colors.textSecondary,
              margin: 0,
            }}
          >
            Manage household profiles. Each profile maintains isolated viewing data.
          </p>
        </div>

        <Button
          variant="primary"
          size="sm"
          onClick={() => setIsCreateModalOpen(true)}
          icon={<PlusIcon size={14} />}
        >
          NEW PROFILE
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
                    SWITCH TO
                  </Button>
                ) : (
                  <span
                    style={{
                      fontSize: '12px',
                      fontFamily: FONT_MONO,
                      color: oledTheme.colors.textMuted,
                    }}
                  >
                    Current Profile
                  </span>
                )}

                {profiles.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={deletingId === p.id}
                    onClick={() => handleDeleteProfile(p.id, p.name)}
                    icon={<TrashIcon size={14} color="#EF4444" />}
                    title="Delete profile"
                  />
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Create Profile Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="CREATE NEW PROFILE"
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
                fontSize: '12px',
                fontWeight: 700,
                textTransform: 'uppercase',
                color: oledTheme.colors.textSecondary,
                marginBottom: '8px',
              }}
            >
              Profile Name
            </label>
            <input
              type="text"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              placeholder="e.g. Salotto TV, Marco"
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
                fontSize: '14px',
                outline: 'none',
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontFamily: FONT_MONO,
                fontSize: '12px',
                fontWeight: 700,
                textTransform: 'uppercase',
                color: oledTheme.colors.textSecondary,
                marginBottom: '8px',
              }}
            >
              Avatar Color
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
              CANCEL
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={creating}
              style={{ flex: 1 }}
            >
              CREATE
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
