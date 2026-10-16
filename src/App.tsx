import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import AppShell from './AppShell'
import { defaultSettings } from './db/database'
import { createCloudWorkspace, getOwnedCompanyId, resetCloudWorkspaceCache } from './services/cloud'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import './app-layout.css'

const connectionTimeoutMs = 15_000

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), connectionTimeoutMs)
    promise.then(
      (value) => { window.clearTimeout(timeout); resolve(value) },
      (error: unknown) => { window.clearTimeout(timeout); reject(error) },
    )
  })
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [checking, setChecking] = useState(true)
  const [workspaceState, setWorkspaceState] = useState<'checking' | 'setup' | 'ready' | 'error'>('checking')
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const sharedLoginEmail = import.meta.env.VITE_SHARED_LOGIN_EMAIL?.trim()

  useEffect(() => {
    if (!supabase) return
    let active = true
    void withTimeout(
      supabase.auth.getSession(),
      'Supabase terlalu lama merespons. Periksa koneksi internet lalu coba masuk lagi.',
    ).then(({ data, error }) => {
      if (!active) return
      if (error) setErrorMessage(error.message)
      else setErrorMessage('')
      setSession(data.session)
      setChecking(false)
    }).catch((error: unknown) => {
      if (!active) return
      setErrorMessage(error instanceof Error ? error.message : 'Sesi Supabase tidak dapat diperiksa.')
      setChecking(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      resetCloudWorkspaceCache()
      setSession(nextSession)
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') setWorkspaceState('checking')
      setErrorMessage('')
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [])

  const userId = session?.user.id
  useEffect(() => {
    if (!userId) return
    let active = true
    void withTimeout(
      getOwnedCompanyId(),
      'Workspace Supabase terlalu lama merespons. Periksa koneksi internet lalu coba lagi.',
    ).then((id) => {
      if (active) setWorkspaceState(id ? 'ready' : 'setup')
    }).catch((error: unknown) => {
      if (!active) return
      setErrorMessage(error instanceof Error ? error.message : 'Workspace tidak dapat dimuat.')
      setWorkspaceState('error')
    })
    return () => { active = false }
  }, [userId])

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    if (!sharedLoginEmail) {
      setErrorMessage('Login bersama belum dikonfigurasi. Isi VITE_SHARED_LOGIN_EMAIL di .env.local, lalu build ulang.')
      return
    }
    setBusy(true); setErrorMessage('')
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password') ?? '')
    try {
      const result = await supabase.auth.signInWithPassword({ email: sharedLoginEmail, password })
      if (result.error) { setErrorMessage(result.error.message); return }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Autentikasi gagal.')
    } finally { setBusy(false) }
  }

  async function submitWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setErrorMessage('')
    const form = new FormData(event.currentTarget)
    const timezone = String(form.get('timezone') ?? '').trim()
    try { new Intl.DateTimeFormat('id-ID', { timeZone: timezone }).format() }
    catch { setBusy(false); setErrorMessage('Masukkan zona waktu IANA yang valid, misalnya Asia/Jakarta.'); return }
    const settings = {
      ...defaultSettings,
      companyName: String(form.get('companyName') ?? '').trim() || 'RANCAUPAS BEAUTY',
      companyAddress: String(form.get('address') ?? ''), phone: String(form.get('phone') ?? ''),
      email: String(form.get('companyEmail') ?? ''), invoicePrefix: String(form.get('prefix') ?? 'RB').trim().toUpperCase() || 'RB',
    }
    try {
      await createCloudWorkspace(settings, timezone)
      setWorkspaceState('ready')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Workspace gagal dibuat.')
    } finally { setBusy(false) }
  }

  async function signOut() {
    if (!supabase) return
    await supabase.auth.signOut()
    resetCloudWorkspaceCache()
  }

  if (!isSupabaseConfigured || !supabase) return <AuthFrame title="Supabase belum dikonfigurasi">
    <p>Tambahkan URL project dan publishable/anon key ke file <code>.env.local</code>, lalu build ulang untuk web dan Android.</p>
    <pre>VITE_SUPABASE_URL=https://project-ref.supabase.co{ '\n' }VITE_SUPABASE_ANON_KEY=publishable-key</pre>
  </AuthFrame>

  if (checking || (session && workspaceState === 'checking')) return <div className="auth-screen"><div className="auth-loading"><span className="spinner" /> Menghubungkan ke Supabase…</div></div>

  if (!session) return <AuthFrame title="RANCAUPAS BEAUTY" subtitle="Business Desk · Supabase">
    <form className="auth-form" onSubmit={submitAuth}>
      <label className="field"><span>Kata sandi</span><input name="password" type="password" autoComplete="current-password" minLength={8} required /></label>
      {!sharedLoginEmail && <p className="auth-message error">Login bersama belum dikonfigurasi. Tambahkan VITE_SHARED_LOGIN_EMAIL di .env.local.</p>}
      {errorMessage && <p className="auth-message error">{errorMessage}</p>}
      <button className="button button-primary" type="submit" disabled={busy || !sharedLoginEmail}>{busy ? 'Memproses…' : 'Masuk'}</button>
    </form>
  </AuthFrame>

  if (workspaceState === 'setup') return <AuthFrame title="Siapkan workspace" subtitle="Data web dan Android akan tersimpan di perusahaan ini.">
    <form className="auth-form" onSubmit={submitWorkspace}>
      <label className="field"><span>Nama perusahaan</span><input name="companyName" defaultValue="RANCAUPAS BEAUTY" required /></label>
      <label className="field"><span>Zona waktu invoice (IANA)</span><input name="timezone" placeholder="Asia/Jakarta" required /></label>
      <label className="field"><span>Awalan invoice</span><input name="prefix" defaultValue="RB" maxLength={8} required /></label>
      <label className="field"><span>Email perusahaan</span><input name="companyEmail" type="email" /></label>
      <label className="field"><span>Nomor telepon</span><input name="phone" type="tel" /></label>
      <label className="field"><span>Alamat perusahaan</span><input name="address" /></label>
      {errorMessage && <p className="auth-message error">{errorMessage}</p>}
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Membuat workspace…' : 'Buat workspace'}</button>
    </form>
  </AuthFrame>

  if (workspaceState === 'error') return <AuthFrame title="Workspace tidak dapat dibuka">{errorMessage && <p className="auth-message error">{errorMessage}</p>}<button className="button button-primary" onClick={() => window.location.reload()}>Coba lagi</button></AuthFrame>
  return <AppShell onSignOut={() => void signOut()} />
}

function AuthFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return <main className="auth-screen"><section className="auth-panel"><div className="auth-brand">RB <span>RANCAUPAS BEAUTY</span></div><h1>{title}</h1>{subtitle && <p className="auth-subtitle">{subtitle}</p>}{children}</section></main>
}