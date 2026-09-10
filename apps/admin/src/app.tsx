import { useEffect, useMemo, useRef, useState } from 'react';
import { adminApi, API_BASE, type SkillRow, type TaskRow } from './api';
import { mountModelConfig } from '../static/model-config.js';
import { mountSkillManager } from '../static/skill-manager.js';

type View = 'skills' | 'tasks' | 'models';

export function App() {
  const [authenticated, setAuthenticated] = useState(sessionStorage.getItem('admin-session') === 'local');
  if (!authenticated) return <Login onSuccess={() => setAuthenticated(true)} />;
  return <Dashboard />;
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [error, setError] = useState('');
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('username') === 'admin' && form.get('password') === 'admin') {
      sessionStorage.setItem('admin-session', 'local'); onSuccess();
    } else setError('账号或密码不正确');
  };
  return <main className="login-shell"><section className="login-panel"><div className="brand-mark">Z</div><h1>造像台</h1><p>本地创作能力管理</p><form onSubmit={submit}><label>账号<input name="username" defaultValue="admin" autoComplete="username" /></label><label>密码<input name="password" type="password" defaultValue="admin" autoComplete="current-password" /></label>{error && <div className="form-error">{error}</div>}<button className="primary-button" type="submit">进入控制台</button></form></section></main>;
}

function Dashboard() {
  const [view, setView] = useState<View>('skills');
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = async () => { setLoading(true); setError(''); try { const [skillRows, taskRows] = await Promise.all([adminApi.skills(), adminApi.tasks()]); setSkills(skillRows); setTasks(taskRows); } catch (reason) { setError(reason instanceof Error ? reason.message : '加载失败'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const active = useMemo(() => skills.filter((skill) => skill.status === 'PUBLISHED').length, [skills]);
  const running = useMemo(() => tasks.filter((task) => ['QUEUED', 'PROCESSING', 'RETRYING'].includes(task.status)).length, [tasks]);
  return <div className="app-shell">
    <aside><div className="wordmark"><span>造</span><strong>造像台</strong></div>
      <nav>{(['skills', 'tasks', 'models'] as const).map((item) => <button key={item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>{item === 'skills' ? 'Skill 管理' : item === 'tasks' ? '任务记录' : '模型配置'}</button>)}</nav>
      <div className="admin-user"><span>A</span><div><strong>本地管理员</strong><small>Local admin</small></div></div>
    </aside>
    <main className="workspace">
      <header><div><p>AI PHOTO STUDIO</p><h1>{view === 'skills' ? 'Skill 管理' : view === 'tasks' ? '任务记录' : '模型配置'}</h1></div>{view === 'tasks' && <button className="icon-button" title="刷新" onClick={() => void load()}>↻</button>}</header>
      {view === 'models' ? <ModelSettings /> : <>
        <section className="metrics"><div><span>已发布 Skill</span><strong>{active}</strong></div><div><span>执行中任务</span><strong>{running}</strong></div><div><span>累计任务</span><strong>{tasks.length}</strong></div></section>
        {error && <div className="alert">{error}</div>}
        {loading ? <div className="state">正在加载…</div> : view === 'skills' ? <SkillSettings onChanged={() => void load()} /> : <TaskTable tasks={tasks} />}
      </>}
    </main>
  </div>;
}

function ModelSettings() {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (container.current) return mountModelConfig(container.current, API_BASE);
  }, []);
  return <div ref={container} />;
}

function SkillSettings({ onChanged }: { onChanged: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onChanged);
  callback.current = onChanged;
  useEffect(() => {
    if (container.current) return mountSkillManager(container.current, API_BASE, { onChanged: () => callback.current() });
  }, []);
  return <div ref={container} />;
}

function TaskTable({ tasks }: { tasks: TaskRow[] }) {
  if (!tasks.length) return <div className="state">暂无任务记录</div>;
  return <section className="data-section"><div className="section-heading"><h2>最近任务</h2><span>{tasks.length} 条</span></div><div className="table-wrap"><table><thead><tr><th>任务编号</th><th>玩法</th><th>进度</th><th>重试</th><th>状态</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.id}><td><strong>{task.taskNo}</strong><small>{new Date(task.createdAt).toLocaleString()}</small></td><td>{task.skillId}</td><td><div className="progress"><i style={{ width: `${task.progress}%` }} /></div></td><td>{task.retryCount}</td><td><Status value={task.status} /></td></tr>)}</tbody></table></div></section>;
}

function Status({ value }: { value: string }) { return <span className={`status status-${value.toLowerCase()}`}>{value}</span>; }
