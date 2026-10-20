'use client';
import { useTranslation } from '@/app/components/language-provider';

import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MetricsResult, MetricsRange } from '@/lib/space-metrics';

export function MetricsPanel({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const [days, setDays] = useState<MetricsRange>(7);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: MetricsResult; error?: string }>({
    key: '',
  });
  const key = `${spaceId}:${days}:${attempt}`;
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/api/metrics?spaceId=${encodeURIComponent(spaceId)}&days=${days}`,
          { signal: controller.signal },
        );
        const data = (await response.json()) as MetricsResult & { error?: string };
        if (!response.ok) throw new Error(data.error || 'Could not load your stats.');
        if (!controller.signal.aborted) setResult({ key, data });
      } catch (error) {
        if (!controller.signal.aborted)
          setResult({
            key,
            error: error instanceof Error ? error.message : 'Could not load your stats.',
          });
      }
    })();
    return () => controller.abort();
  }, [spaceId, days, key]);
  const loading = result.key !== key;
  const data = !loading ? result.data : undefined;
  return (
    <section className="metrics-panel" aria-label={t('Space analytics')}>
      <div className="metrics-toolbar">
        <h2>{t('Your space, in numbers')}</h2>
        <div className="metrics-range" role="group" aria-label={t('Date range')}>
          {([7, 30] as const).map((range) => (
            <button
              key={range}
              type="button"
              aria-pressed={days === range}
              onClick={() => setDays(range)}
            >
              {range} {' ' + t('days')}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="metrics-placeholder" role="status">
          {t('Loading your stats…')}
        </div>
      ) : result.error ? (
        <div className="metrics-placeholder" role="alert">
          <p>{t(result.error)}</p>
          <button
            type="button"
            className="button button-small"
            onClick={() => setAttempt((n) => n + 1)}
          >
            {t('Try again')}
          </button>
        </div>
      ) : data && !data.configured ? (
        <div className="metrics-placeholder">
          <h3>{t("Stats aren't ready yet")}</h3>
          <p>
            {t(
              'You can keep building your space. Your stats will appear here once analytics is connected.',
            )}
          </p>
        </div>
      ) : data?.configured ? (
        <MetricsReport data={data} />
      ) : null}
    </section>
  );
}

export function MetricsReport({ data }: { data: Extract<MetricsResult, { configured: true }> }) {
  const { t, locale } = useTranslation();
  const number = (value: number) => value.toLocaleString(locale);
  const dateLabel = (value: string) =>
    new Date(`${value}T00:00:00Z`).toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });

  const days = data.days;
  return (
    <>
      <dl className="metrics-totals">
        <div>
          <dt>{t('Profile views')}</dt>
          <dd>{number(data.views)}</dd>
        </div>
        <div>
          <dt>{t('Link & button clicks')}</dt>
          <dd>{number(data.clicks)}</dd>
        </div>
      </dl>
      {data.views === 0 && data.clicks === 0 ? (
        <div className="metrics-placeholder">
          <h3>{t('Your next visitor starts the story')}</h3>
          <p>
            {t(
              'Your stats will appear after people visit your page. Share your profile to get started.',
            )}
          </p>
        </div>
      ) : (
        <>
          <div className="metrics-chart">
            <h3>{t('Daily activity')}</h3>
            <p className="field-description">
              {dateLabel(data.daily[0].date)} – {dateLabel(data.daily.at(-1)!.date)}{' '}
              {' ' + t('· UTC · today is still in progress')}
            </p>
            <div
              className="metrics-plot"
              role="img"
              aria-label={t(
                'Daily activity over {days} days. {views} profile views and {clicks} clicks. A daily data table follows.',
                { days, views: number(data.views), clicks: number(data.clicks) },
              )}
            >
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={data.daily}
                  margin={{ top: 12, right: 8, left: -20, bottom: 0 }}
                  accessibilityLayer
                >
                  <CartesianGrid vertical={false} stroke="var(--ink)" strokeOpacity={0.15} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={dateLabel}
                    minTickGap={28}
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                  />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} />
                  <Tooltip
                    labelFormatter={(label) => dateLabel(String(label))}
                    contentStyle={{
                      background: 'var(--paper)',
                      border: '2px solid var(--ink)',
                      borderRadius: 4,
                      color: 'var(--ink)',
                    }}
                    cursor={{ fill: 'var(--ink)', fillOpacity: 0.05 }}
                  />
                  <Legend
                    iconType="square"
                    formatter={(value) => <span style={{ color: 'var(--ink)' }}>{value}</span>}
                  />
                  <Bar
                    dataKey="views"
                    name={t('Views')}
                    fill="var(--lilac)"
                    stroke="var(--ink)"
                    strokeWidth={1.5}
                    maxBarSize={28}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="clicks"
                    name={t('Clicks')}
                    fill="var(--yellow)"
                    stroke="var(--ink)"
                    strokeWidth={1.5}
                    maxBarSize={28}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <details className="metrics-data">
              <summary>{t('View daily numbers')}</summary>
              <table>
                <caption>{t('Daily activity (UTC)')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('Date')}</th>
                    <th scope="col">{t('Views')}</th>
                    <th scope="col">{t('Clicks')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((day) => (
                    <tr key={day.date}>
                      <th scope="row">{dateLabel(day.date)}</th>
                      <td>{number(day.views)}</td>
                      <td>{number(day.clicks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
          <section className="metrics-top">
            <h3>{t('Most-clicked items')}</h3>
            {data.topItems.length ? (
              <ol>
                {data.topItems.map((item) => (
                  <li key={item.id}>
                    <span>
                      {item.label}
                      <small>
                        {item.kind === 'discord'
                          ? t('Discord server')
                          : item.kind === 'interest'
                            ? t('Game')
                            : item.kind === 'project'
                              ? t('Project')
                              : t('Link')}
                      </small>
                    </span>
                    <strong>
                      {number(item.clicks)} <span>{t('clicks')}</span>
                    </strong>
                  </li>
                ))}
              </ol>
            ) : (
              <p>{t('No clicks yet. Your most popular items will appear here.')}</p>
            )}
          </section>
        </>
      )}
      <p className="metrics-note">
        {t('Updated')}{' '}
        {new Date(data.updatedAt).toLocaleTimeString(locale, {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'UTC',
        })}{' '}
        {t('UTC. Stats refresh about every five minutes and may take a little longer to arrive.')}
      </p>
      <p className="metrics-note">
        {t(
          "Counts start when analytics is enabled. Repeat visits and clicks count again; these aren't unique people. Privacy settings and blockers can reduce counts. Visits directly to short URLs aren't included.",
        )}
      </p>
    </>
  );
}
