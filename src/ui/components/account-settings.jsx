import React from 'react';
import { Icon, tint, alpha } from './primitives';
import { trpc } from '@/ui/lib/trpc';

const { useEffect, useMemo, useState } = React;

const navItems = [
  { id: 'account', label: 'Account', icon: 'at' },
  { id: 'profile', label: 'Profile', icon: 'edit' },
  { id: 'skills', label: 'Skills', icon: 'sparkle' },
  { id: 'memory', label: 'Project memory', icon: 'pin' },
  { id: 'preferences', label: 'Preferences', icon: 'moon' },
];

const fieldStyle = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r-sm)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  font: 'inherit',
  fontSize: 13,
  lineHeight: 1.45,
  padding: '10px 11px',
  outline: 'none',
};

function AccountSettings({
  open,
  onClose,
  authStatus,
  user,
  workbench,
  theme,
  onThemeChange,
  onSignIn,
  onSignOut,
}) {
  const authed = authStatus === 'authenticated';
  const [tab, setTab] = useState('account');
  const compact = useCompactSettings();
  const utils = trpc.useUtils();

  const profileQ = trpc.userProfile.get.useQuery(undefined, { enabled: open && authed });
  const skillsQ = trpc.userSkills.list.useQuery(undefined, { enabled: open && authed });
  const suggestionsQ = trpc.userSkills.suggestions.useQuery(undefined, { enabled: open && authed });
  const pinsQ = trpc.workbenchPinned.list.useQuery(
    { workbenchId: workbench?.id || '' },
    { enabled: open && authed && Boolean(workbench?.id) },
  );

  const updateProfile = trpc.userProfile.update.useMutation({
    onSuccess: () => {
      utils.userProfile.get.invalidate();
      utils.userSkills.list.invalidate();
    },
  });
  const upsertSkill = trpc.userSkills.upsert.useMutation({
    onSuccess: () => {
      utils.userSkills.list.invalidate();
      utils.userSkills.suggestions.invalidate();
    },
  });
  const setSkillEnabled = trpc.userSkills.setEnabled.useMutation({
    onSuccess: () => utils.userSkills.list.invalidate(),
  });
  const deleteSkill = trpc.userSkills.delete.useMutation({
    onSuccess: () => {
      utils.userSkills.list.invalidate();
      utils.userSkills.suggestions.invalidate();
    },
  });
  const addPin = trpc.workbenchPinned.pin.useMutation({
    onSuccess: () => utils.workbenchPinned.list.invalidate({ workbenchId: workbench?.id || '' }),
  });
  const removePin = trpc.workbenchPinned.unpin.useMutation({
    onSuccess: () => utils.workbenchPinned.list.invalidate({ workbenchId: workbench?.id || '' }),
  });

  const profile = profileQ.data;
  const [displayName, setDisplayName] = useState('');
  const [brief, setBrief] = useState('');
  const [defaultSkills, setDefaultSkills] = useState('');
  const [notes, setNotes] = useState('');
  const [newPin, setNewPin] = useState('');

  useEffect(() => {
    if (!open) return;
    setTab('account');
  }, [open]);

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.displayName || user?.name || '');
    setBrief(profile.defaultBrief || '');
    setDefaultSkills((profile.defaultSkills || []).join('\n'));
    setNotes(profile.notes || '');
  }, [profile, user?.name]);

  const skills = skillsQ.data || [];
  const enabledSkills = skills.filter((skill) => skill.enabled);
  const personalSkills = enabledSkills.filter((skill) => skill.scope !== 'mission');
  const missionSkills = enabledSkills.filter((skill) => skill.scope === 'mission');
  const suggestionKeys = new Set(skills.map((skill) => skill.key));
  const suggestions = (suggestionsQ.data || []).filter((skill) => !suggestionKeys.has(skill.key));
  const pins = pinsQ.data || [];
  const busy = updateProfile.isPending || upsertSkill.isPending || setSkillEnabled.isPending || deleteSkill.isPending;

  const saveProfile = () => {
    updateProfile.mutate({
      displayName: displayName.trim(),
      defaultBrief: brief.trim(),
      defaultSkills: splitLines(defaultSkills),
      notes: notes.trim(),
    });
  };
  const acceptSkill = (skill) => {
    upsertSkill.mutate({
      key: skill.key,
      label: skill.label,
      description: skill.description,
      source: skill.source,
      scope: 'personal',
      targetChatId: null,
      evidence: skill.evidence,
      enabled: true,
    });
  };
  const addProjectPin = () => {
    const content = newPin.trim();
    if (!content || !workbench?.id) return;
    addPin.mutate({ workbenchId: workbench.id, content });
    setNewPin('');
  };

  const statusLine = useMemo(() => {
    if (!authed) return 'Signed out';
    const count = enabledSkills.length;
    return `${count} skill${count === 1 ? '' : 's'} active`;
  }, [authed, enabledSkills.length]);

  if (!open) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 180, background: alpha('#1f1930', 34),
      backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'flex-end' }}
      onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="rt-rise"
        style={{ width: 'min(920px, 100vw)', height: '100%', background: 'var(--surface)',
          borderLeft: '1px solid var(--border)', boxShadow: 'var(--shadow-pop)',
          display: 'grid', gridTemplateColumns: compact ? '1fr' : '240px minmax(0, 1fr)',
          gridTemplateRows: compact ? 'auto minmax(0, 1fr)' : '1fr', overflow: 'hidden' }}>
        <aside style={{ borderRight: compact ? 'none' : '1px solid var(--border)',
          borderBottom: compact ? '1px solid var(--border)' : 'none', background: 'var(--bg)',
          padding: compact ? 12 : 16, display: 'flex', flexDirection: compact ? 'row' : 'column',
          gap: compact ? 10 : 14, minWidth: 0, overflowX: compact ? 'auto' : 'visible' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center',
              background: tint('var(--accent)', 13), color: 'var(--accent)', flexShrink: 0 }}>
              <Icon name="at" size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 850, color: 'var(--text)' }}>Settings</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {statusLine}
              </div>
            </div>
          </div>

          <nav style={{ display: compact ? 'flex' : 'grid', gap: 5, minWidth: compact ? 'max-content' : 0 }}>
            {navItems.map((item) => (
              <button key={item.id} onClick={() => setTab(item.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%',
                  padding: '9px 10px', borderRadius: 'var(--r-sm)', border: '1px solid',
                  borderColor: tab === item.id ? 'color-mix(in oklab, var(--accent) 42%, var(--border))' : 'transparent',
                  background: tab === item.id ? tint('var(--accent)', 9) : 'transparent',
                  color: tab === item.id ? 'var(--text)' : 'var(--text-muted)',
                  font: 'inherit', fontSize: 13, fontWeight: 750, cursor: 'pointer', textAlign: 'left' }}>
                <Icon name={item.icon} size={14} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
              </button>
            ))}
          </nav>

          {!compact && <div style={{ marginTop: 'auto', display: 'grid', gap: 8 }}>
            <div style={{ padding: 11, borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
              background: 'var(--surface)', display: 'grid', gap: 4 }}>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 800 }}>Signed in as</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
                {authed ? user?.email : 'No account'}
              </div>
            </div>
            <button onClick={onClose} style={buttonStyle('neutral')}>
              <Icon name="x" size={14} /> Close
            </button>
          </div>}
        </aside>

        <main style={{ minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
          <header style={{ height: 58, flexShrink: 0, padding: '0 20px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 850, color: 'var(--text)' }}>{titleForTab(tab)}</div>
              <div style={{ marginTop: 2, fontSize: 12, color: 'var(--text-faint)' }}>{subtitleForTab(tab)}</div>
            </div>
            <button onClick={onClose} title="Close settings" style={{ ...iconButton, width: 32, height: 32 }}>
              <Icon name="x" size={15} />
            </button>
          </header>

          <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
            {!authed ? (
              <SignedOutState onSignIn={onSignIn} />
            ) : tab === 'account' ? (
              <AccountSection user={user} onSignOut={onSignOut} />
            ) : tab === 'profile' ? (
              <ProfileSection
                loading={profileQ.isLoading}
                displayName={displayName}
                setDisplayName={setDisplayName}
                brief={brief}
                setBrief={setBrief}
                defaultSkills={defaultSkills}
                setDefaultSkills={setDefaultSkills}
                notes={notes}
                setNotes={setNotes}
                saving={updateProfile.isPending}
                error={updateProfile.error?.message}
                saved={updateProfile.isSuccess}
                onSave={saveProfile}
              />
            ) : tab === 'skills' ? (
              <SkillsSection
                loading={skillsQ.isLoading}
                skills={skills}
                personalSkills={personalSkills}
                missionSkills={missionSkills}
                suggestions={suggestions}
                busy={busy}
                onAccept={acceptSkill}
                onToggle={(skill) => setSkillEnabled.mutate({
                  key: skill.key,
                  enabled: !skill.enabled,
                  scope: skill.scope,
                  targetChatId: skill.targetChatId,
                })}
                onRemove={(skill) => deleteSkill.mutate({
                  key: skill.key,
                  scope: skill.scope,
                  targetChatId: skill.targetChatId,
                })}
              />
            ) : tab === 'memory' ? (
              <ProjectMemorySection
                workbench={workbench}
                pins={pins}
                loading={pinsQ.isLoading}
                newPin={newPin}
                setNewPin={setNewPin}
                saving={addPin.isPending || removePin.isPending}
                error={addPin.error?.message || removePin.error?.message}
                onAdd={addProjectPin}
                onRemove={(pin) => workbench?.id && removePin.mutate({ workbenchId: workbench.id, id: pin.id })}
              />
            ) : (
              <PreferencesSection theme={theme} onThemeChange={onThemeChange} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function useCompactSettings() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return compact;
}

function SignedOutState({ onSignIn }) {
  return (
    <section style={emptyState}>
      <Icon name="at" size={24} />
      <div style={{ fontSize: 16, fontWeight: 850 }}>Sign in to use settings</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Profile, skills, and project memory are saved to your account.
      </div>
      <button onClick={onSignIn} style={{ ...buttonStyle('primary'), justifySelf: 'center' }}>
        <Icon name="at" size={14} /> Sign in
      </button>
    </section>
  );
}

function AccountSection({ user, onSignOut }) {
  const initials = initialsFor(user?.name || user?.email);
  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
      <section style={panelStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 54, height: 54, borderRadius: 18, display: 'grid', placeItems: 'center',
            background: tint('var(--accent)', 14), color: 'var(--accent)', fontSize: 18, fontWeight: 900 }}>
            {initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 850, color: 'var(--text)' }}>{user?.name || 'Roundtable user'}</div>
            <div style={{ marginTop: 3, fontSize: 13, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{user?.email}</div>
          </div>
        </div>
      </section>

      <section style={panelStyle}>
        <SectionHeader title="Login" meta="Google OAuth" />
        <div style={{ display: 'grid', gap: 9 }}>
          <InfoRow label="Email" value={user?.email || '-'} />
          <InfoRow label="Provider" value="Google or developer auth" />
        </div>
      </section>

      <section style={panelStyle}>
        <SectionHeader title="Session" meta="Current browser" />
        <button onClick={onSignOut} style={{ ...buttonStyle('neutral'), justifySelf: 'start' }}>
          <Icon name="door" size={14} /> Sign out
        </button>
      </section>
    </div>
  );
}

function ProfileSection(props) {
  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
      <section style={panelStyle}>
        <SectionHeader title="Identity" meta={props.loading ? 'Loading' : 'Saved to profile'} />
        <label style={labelStyle}>
          Display name
          <input value={props.displayName} onChange={(event) => props.setDisplayName(event.target.value)}
            placeholder="Your name in Roundtable" style={fieldStyle} />
        </label>
      </section>

      <section style={panelStyle}>
        <SectionHeader title="Working profile" meta="Used in new handoffs" />
        <label style={labelStyle}>
          Default brief
          <textarea value={props.brief} onChange={(event) => props.setBrief(event.target.value)}
            rows={4} placeholder="What should the team know before planning for you?" style={fieldStyle} />
        </label>
        <label style={labelStyle}>
          Default skills
          <textarea value={props.defaultSkills} onChange={(event) => props.setDefaultSkills(event.target.value)}
            rows={4} placeholder="One skill per line, for example: Plan before implementation" style={fieldStyle} />
        </label>
        <label style={labelStyle}>
          Private notes
          <textarea value={props.notes} onChange={(event) => props.setNotes(event.target.value)}
            rows={4} placeholder="Notes that should shape future task setup." style={fieldStyle} />
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <button onClick={props.onSave} disabled={props.saving} style={buttonStyle('primary')}>
            <Icon name="check" size={14} /> {props.saving ? 'Saving' : 'Save profile'}
          </button>
          {props.error && <span style={errorText}>{props.error}</span>}
          {props.saved && !props.saving && !props.error && <span style={successText}>Saved</span>}
        </div>
      </section>
    </div>
  );
}

function SkillsSection({ loading, skills, personalSkills, missionSkills, suggestions, busy, onAccept, onToggle, onRemove }) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section style={{ ...panelStyle, background: 'linear-gradient(180deg, color-mix(in oklab, var(--surface) 94%, var(--accent)), var(--surface))' }}>
        <SectionHeader title="Working style" meta={`${personalSkills.length} always-on · ${missionSkills.length} mission`} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {personalSkills.length === 0 ? (
            <MutedText>No always-on skills yet.</MutedText>
          ) : personalSkills.map((skill) => <SkillPill key={skill.id || skill.key} skill={skill} />)}
        </div>
      </section>

      <section style={panelStyle}>
        <SectionHeader title="Recommended" meta={`${suggestions.length} available`} />
        <div style={{ display: 'grid', gap: 9 }}>
          {suggestions.length === 0 ? (
            <MutedText>No new recommendations right now.</MutedText>
          ) : suggestions.slice(0, 5).map((skill) => (
            <SkillRow key={skill.key} skill={skill} action={
              <button disabled={busy} onClick={() => onAccept(skill)} style={buttonStyle('neutral')}>Accept</button>
            } />
          ))}
        </div>
      </section>

      <section style={panelStyle}>
        <SectionHeader title="Saved skills" meta={loading ? 'Loading' : `${skills.length} saved`} />
        <div style={{ display: 'grid', gap: 9 }}>
          {loading ? (
            <MutedText>Loading skills...</MutedText>
          ) : skills.length === 0 ? (
            <MutedText>No saved skills yet.</MutedText>
          ) : skills.map((skill) => (
            <SkillRow key={skill.id || skill.key} skill={skill} action={
              <div style={{ display: 'flex', gap: 7 }}>
                <button disabled={busy} onClick={() => onToggle(skill)} style={buttonStyle(skill.enabled ? 'neutral' : 'primary')}>
                  {skill.enabled ? 'Disable' : 'Enable'}
                </button>
                <button disabled={busy} onClick={() => onRemove(skill)} style={buttonStyle('ghost')}>Remove</button>
              </div>
            } />
          ))}
        </div>
      </section>
    </div>
  );
}

function ProjectMemorySection({ workbench, pins, loading, newPin, setNewPin, saving, error, onAdd, onRemove }) {
  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
      <section style={panelStyle}>
        <SectionHeader title={workbench?.name || 'Current workbench'} meta="Project rules" />
        <div style={{ display: 'grid', gap: 9 }}>
          {loading ? (
            <MutedText>Loading project memory...</MutedText>
          ) : pins.length === 0 ? (
            <MutedText>No project rules pinned yet.</MutedText>
          ) : pins.map((pin) => (
            <div key={pin.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '10px 11px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
              <Icon name="pin" size={14} style={{ color: 'var(--accent)', marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.45, color: 'var(--text)' }}>{pin.content}</div>
              <button disabled={saving} onClick={() => onRemove(pin)} title="Remove rule" style={iconButton}>
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section style={panelStyle}>
        <SectionHeader title="Add project rule" meta={workbench?.id ? 'Current workspace' : 'Open a workspace'} />
        <textarea value={newPin} onChange={(event) => setNewPin(event.target.value)}
          rows={3} placeholder="For example: UI changes need a screenshot before merge." style={fieldStyle} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <button onClick={onAdd} disabled={!newPin.trim() || saving || !workbench?.id} style={buttonStyle('primary')}>
            <Icon name="plus" size={14} /> Add rule
          </button>
          {error && <span style={errorText}>{error}</span>}
        </div>
      </section>
    </div>
  );
}

function PreferencesSection({ theme, onThemeChange }) {
  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
      <section style={panelStyle}>
        <SectionHeader title="Theme" meta="This browser" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['light', 'dark'].map((value) => (
            <button key={value} onClick={() => onThemeChange(value)}
              style={{ ...buttonStyle(theme === value ? 'primary' : 'neutral'), textTransform: 'capitalize' }}>
              <Icon name={value === 'light' ? 'sun' : 'moon'} size={14} /> {value}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function SectionHeader({ title, meta }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
      <div style={{ fontSize: 14.5, fontWeight: 850, color: 'var(--text)' }}>{title}</div>
      {meta && <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{meta}</div>}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', gap: 12, alignItems: 'baseline',
      padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 750 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text)', overflowWrap: 'anywhere' }}>{value}</div>
    </div>
  );
}

function SkillPill({ skill }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px',
      borderRadius: 'var(--r-chip)', background: tint(skill.scope === 'mission' ? 'var(--ok)' : 'var(--accent)', 13),
      color: skill.scope === 'mission' ? 'var(--ok)' : 'var(--accent)', fontSize: 12, fontWeight: 850 }}>
      <Icon name={skill.scope === 'mission' ? 'pin' : 'sparkle'} size={12} /> {skill.label}
    </span>
  );
}

function SkillRow({ skill, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 12px',
      borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: skill.enabled === false ? 'var(--surface-2)' : 'var(--surface)' }}>
      <span style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 8,
        background: skill.enabled === false ? 'var(--surface-3)' : tint('var(--accent)', 12),
        color: skill.enabled === false ? 'var(--text-faint)' : 'var(--accent)', flexShrink: 0 }}>
        <Icon name={skill.scope === 'mission' ? 'pin' : 'sparkle'} size={13} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13.3, fontWeight: 850, color: 'var(--text)' }}>{skill.label}</div>
          <Badge>{skill.scope || 'personal'}</Badge>
          {skill.enabled === false && <Badge>off</Badge>}
        </div>
        <div style={{ marginTop: 3, fontSize: 12.2, lineHeight: 1.4, color: 'var(--text-muted)' }}>{skill.description}</div>
      </div>
      {action}
    </div>
  );
}

function Badge({ children }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 6px', borderRadius: 5,
      background: 'var(--surface-3)', color: 'var(--text-faint)', fontSize: 10.5, fontWeight: 800,
      textTransform: 'uppercase', letterSpacing: '.05em' }}>{children}</span>
  );
}

function MutedText({ children }) {
  return <div style={{ fontSize: 12.5, color: 'var(--text-faint)', fontStyle: 'italic' }}>{children}</div>;
}

function buttonStyle(kind) {
  const primary = kind === 'primary';
  const ghost = kind === 'ghost';
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    padding: '8px 12px',
    borderRadius: 'var(--r-sm)',
    border: primary || ghost ? 'none' : '1px solid var(--border)',
    background: primary ? 'var(--accent)' : ghost ? 'transparent' : 'var(--surface-2)',
    color: primary ? '#fff' : ghost ? 'var(--text-muted)' : 'var(--text)',
    font: 'inherit',
    fontSize: 12.5,
    fontWeight: 800,
    cursor: 'pointer',
  };
}

function titleForTab(tab) {
  return navItems.find((item) => item.id === tab)?.label || 'Settings';
}

function subtitleForTab(tab) {
  if (tab === 'account') return 'Your sign-in identity and current session.';
  if (tab === 'profile') return 'The default context Roundtable uses when planning with you.';
  if (tab === 'skills') return 'Reusable working habits that guide new missions.';
  if (tab === 'memory') return 'Rules that travel with the current workbench.';
  return 'Small interface choices for this browser.';
}

function splitLines(value) {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function initialsFor(value) {
  const text = String(value || 'R').trim();
  if (!text) return 'R';
  const parts = text.includes('@') ? [text[0]] : text.split(/\s+/);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}

const panelStyle = {
  display: 'grid',
  gap: 13,
  padding: 16,
  borderRadius: 'var(--r-card)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  boxShadow: 'var(--shadow-card)',
};

const labelStyle = {
  display: 'grid',
  gap: 7,
  fontSize: 12.5,
  color: 'var(--text-muted)',
  fontWeight: 750,
};

const iconButton = {
  display: 'grid',
  placeItems: 'center',
  width: 28,
  height: 28,
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  flexShrink: 0,
};

const emptyState = {
  minHeight: 320,
  display: 'grid',
  alignContent: 'center',
  justifyItems: 'center',
  gap: 12,
  textAlign: 'center',
  color: 'var(--text)',
};

const errorText = { fontSize: 12, color: 'var(--bad)' };
const successText = { fontSize: 12, color: 'var(--ok)', fontWeight: 750 };

export { AccountSettings };
