'use client';
import { SecurityCheck } from './security-check';
import { useState, useEffect, type FormEvent } from 'react';
import { ArrowRight, Mail } from 'lucide-react';
import { authClient } from '@/lib/auth/client';
import { safeReturnPath } from '@/lib/auth/return-path';

export default function SignInForm({ siteKey }: { siteKey: string }) {
  const [token, setToken] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function send() {
    if (!token) {
      setError('Complete the security check first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email: email.trim(),
        type: 'sign-in',
        fetchOptions: { headers: { 'cf-turnstile-response': token } },
      });
      if (result.error) {
        if (result.error.code === 'OTP_ACTIVE') {
          setSent(true);
          setCooldown(60);
        }
        setError(result.error.message || 'Could not send a code. Please try again.');
        return;
      }
      setSent(true);
      setOtp('');
      setCooldown(300);
    } catch {
      setError('Could not connect. Please try again.');
    } finally {
      setBusy(false);
      setToken('');
      setAttempt((value) => value + 1);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!sent) return send();
    setBusy(true);
    setError('');
    try {
      const result = await authClient.signIn.emailOtp({ email: email.trim(), otp });
      if (result.error) {
        setError(result.error.message || 'That code did not work. Try again.');
        return;
      }
      // OAuth plugin handles its signed continuation; normal sign-in uses only a safe local path.
      const data = result.data as { url?: string; redirect?: boolean } | null;
      if (data?.redirect && data.url) {
        window.location.assign(data.url);
        return;
      }
      window.location.assign(
        safeReturnPath(new URLSearchParams(window.location.search).get('return_to')),
      );
    } catch {
      setError('Could not connect. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="auth-form">
      {!sent ? (
        <label>
          Email address
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={busy}
          />
        </label>
      ) : (
        <>
          <p className="auth-notice">
            <Mail size={18} /> Code sent to <strong>{email}</strong>
          </p>
          <label>
            6-digit code
            <input
              className="otp-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            />
          </label>
          <small>The code expires in 5 minutes. Use the latest email.</small>
        </>
      )}
      {siteKey ? (
        <SecurityCheck siteKey={siteKey} attempt={attempt} onToken={setToken} onError={setError} />
      ) : (
        <p role="alert" className="auth-error">
          Sign-in is temporarily unavailable. Please try again later.
        </p>
      )}
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      <button className="button button-dark" disabled={busy || (!sent && (!siteKey || !token))}>
        {busy ? 'One moment…' : sent ? 'Sign in' : 'Send me a code'}
        <ArrowRight size={18} />
      </button>
      {sent && (
        <div className="auth-actions">
          <button
            type="button"
            className="text-link"
            disabled={busy || cooldown > 0 || !token}
            onClick={send}
          >
            {cooldown ? `Resend in ${cooldown}s` : 'Send a new code'}
          </button>
          <button
            type="button"
            className="text-link"
            disabled={busy}
            onClick={() => {
              setSent(false);
              setError('');
            }}
          >
            Use another email
          </button>
        </div>
      )}
    </form>
  );
}
