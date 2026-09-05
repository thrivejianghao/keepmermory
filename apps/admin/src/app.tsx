import { useEffect, useMemo, useState } from 'react';
import { adminApi, type SkillRow, type TaskRow } from './api';

type View = 'skills' | 'tasks';

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
  const setStatus = async (skill: SkillRow, status: string) => { try { const next = await adminApi.setSkillStatus(skill.id, status); setSkills((rows) => rows.map((row) => row.id === skill.id ? next : row)); } catch (reason) { setError(reason instanceof Error ? reason.message : '更新失败'); } };
  return <div className="app-shell"><aside><div className="wordmark"><span>造</span><strong>造像台</strong></div><nav><button className={view === 'skills' ? 'active' : ''} onClick={() => setView('skills')}><span>◇</span>玩法管理</button><button className={view === 'tasks' ? 'active' : ''} onClick={() => setView('tasks')}><span>≡</span>任务记录</button></nav><div className="admin-user"><span>A</span><div><strong>本地管理员</strong><small>Local admin</small></div></div></aside><main className="workspace"><header><div><p>AI PHOTO STUDIO</p><h1>{view === 'skills' ? '玩法管理' : '任务记录'}</h1></div><button className="icon-button" title="刷新" onClick={() => void load()}>↻</button></header><section className="metrics"><div><span>已发布玩法</span><strong>{active}</strong></div><div><span>执行中任务</span><strong>{running}</strong></div><div><span>累计任务</span><strong>{tasks.length}</strong></div></section>{error && <div className="alert">{error}</div>}{loading ? <div className="state">正在加载…</div> : view === 'skills' ? <SkillTable skills={skills} onStatus={setStatus} /> : <TaskTable tasks={tasks} />}</main></div>;
}

function SkillTable({ skills, onStatus }: { skills: SkillRow[]; onStatus: (skill: SkillRow, status: string) => void }) {
  if (!skills.length) return <div className="state">还没有玩法</div>;
  return <section className="data-section"><div className="section-heading"><h2>全部玩法</h2><span>{skills.length} 项</span></div><div className="table-wrap"><table><thead><tr><th>玩法</th><th>分类</th><th>版本</th><th>状态</th><th>操作</th></tr></thead><tbody>{skills.map((skill, index) => <tr key={skill.id}><td><div className={`skill-thumb tone-${index % 4}`}>{skill.name.slice(0, 1)}</div><div><strong>{skill.name}</strong><small>{skill.id}</small></div></td><td>{skill.category}</td><td>{skill.currentVersion ?? '—'}</td><td><Status value={skill.status} /></td><td><select aria-label={`${skill.name}状态`} value={skill.status} onChange={(event) => onStatus(skill, event.target.value)}><option value="DRAFT">草稿</option><option value="TESTING">测试中</option><option value="PUBLISHED">已发布</option><option value="OFFLINE">已下线</option></select></td></tr>)}</tbody></table></div></section>;
}

function TaskTable({ tasks }: { tasks: TaskRow[] }) {
  if (!tasks.length) return <div className="state">暂无任务记录</div>;
  return <section className="data-section"><div className="section-heading"><h2>最近任务</h2><span>{tasks.length} 条</span></div><div className="table-wrap"><table><thead><tr><th>任务编号</th><th>玩法</th><th>进度</th><th>重试</th><th>状态</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.id}><td><strong>{task.taskNo}</strong><small>{new Date(task.createdAt).toLocaleString()}</small></td><td>{task.skillId}</td><td><div className="progress"><i style={{ width: `${task.progress}%` }} /></div></td><td>{task.retryCount}</td><td><Status value={task.status} /></td></tr>)}</tbody></table></div></section>;
}

function Status({ value }: { value: string }) { return <span className={`status status-${value.toLowerCase()}`}>{value}</span>; }
