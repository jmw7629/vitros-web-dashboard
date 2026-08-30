#!/usr/bin/env python3
"""VITROS ChatGPT -> GitHub -> OpenCode bridge runner."""
from __future__ import annotations
import argparse, fcntl, json, os, re, shlex, shutil, subprocess, sys, time
from pathlib import Path
from typing import Any

BRIDGE_MARKER = "<!-- vitros-opencode-bridge:v1 -->"
DEFAULT_REPO = "jmw7629/vitros-web-dashboard"

class BridgeError(RuntimeError): pass

def run(args:list[str], *, cwd:Path|None=None, check:bool=True, env:dict[str,str]|None=None):
    p=subprocess.run(args,cwd=str(cwd) if cwd else None,text=True,capture_output=True,check=False,env=env)
    if check and p.returncode!=0:
        raise BridgeError(f"Command failed ({p.returncode}): {shlex.join(args)}\nstdout:\n{(p.stdout or '')[-4000:]}\nstderr:\n{(p.stderr or '')[-4000:]}")
    return p

def slugify(v:str,limit:int=52)->str:
    v=re.sub(r"[^a-zA-Z0-9]+","-",v).strip("-").lower(); return v[:limit].rstrip("-") or "task"
def repo_key(r:str)->str: return r.replace("/","__")
def trusted_authors()->set[str]: return {x.strip() for x in os.getenv("BRIDGE_TRUSTED_AUTHORS","jmw7629").split(",") if x.strip()}
def load_state(p:Path)->dict[str,Any]:
    if not p.exists(): return {"processed":{}}
    return json.loads(p.read_text())
def save_state(p:Path,s:dict[str,Any])->None:
    p.parent.mkdir(parents=True,exist_ok=True); t=p.with_suffix(".tmp"); t.write_text(json.dumps(s,indent=2,sort_keys=True)+"\n"); os.chmod(t,0o600); t.replace(p)
def ensure_repo(root:Path,repo:str)->None:
    if not (root/".git").exists(): raise BridgeError(f"Not a Git checkout: {root}")
    if run(["git","status","--porcelain"],cwd=root).stdout.strip(): raise BridgeError("Control checkout is dirty; bridge refuses to run.")
    remote=run(["git","remote","get-url","origin"],cwd=root).stdout.strip().lower().rstrip("/").removesuffix(".git")
    if repo.lower() not in remote: raise BridgeError(f"Unexpected origin {remote!r}; expected {repo!r}")
def list_tasks(repo:str)->list[dict[str,Any]]:
    p=run(["gh","issue","list","--repo",repo,"--state","open","--limit","100","--json","number,title,body,author,url,createdAt"])
    issues=json.loads(p.stdout or "[]"); allowed=trusted_authors(); out=[]
    for i in issues:
        author=((i.get("author") or {}).get("login") or "").strip(); title=(i.get("title") or "").strip(); body=i.get("body") or ""
        if author in allowed and title.startswith("[OC]") and BRIDGE_MARKER in body: out.append(i)
    return sorted(out,key=lambda x:int(x["number"]))
def comment(repo:str,n:int,text:str): run(["gh","issue","comment",str(n),"--repo",repo,"--body",text])
def branch_exists(root:Path,b:str)->bool:
    if run(["git","show-ref","--verify","--quiet",f"refs/heads/{b}"],cwd=root,check=False).returncode==0:return True
    return run(["git","ls-remote","--exit-code","--heads","origin",b],cwd=root,check=False).returncode==0
def build_prompt(i:dict[str,Any])->str:
    return f"""You are the implementation executor for VITROS GitHub issue #{i['number']}: {i['title']}\n\nRead AGENTS.md first and obey it. Inspect existing implementation before edits. Work only in this worktree. Do not commit/push/merge/tag/create branches; the bridge owns Git. Do not modify AGENTS.md or bridge/ unless explicitly requested. Never expose secrets or auth files. Never fabricate test/build/deployment results. Keep existing VITROS behavior unless the issue authorizes a change. Finish with a concise report listing changed files, commands/checks actually run, failures/unavailable checks and remaining risks.\n\n--- BEGIN APPROVED ISSUE ---\n{i.get('body') or ''}\n--- END APPROVED ISSUE ---\n"""
def process(root:Path,repo:str,i:dict[str,Any],state:dict[str,Any],state_path:Path,wtroot:Path):
    n=int(i["number"]); short=(i.get("title") or "").removeprefix("[OC]").strip(); branch=f"oc/issue-{n}-{slugify(short)}"; wt=wtroot/f"issue-{n}"; logs=state_path.parent/"logs"; logs.mkdir(parents=True,exist_ok=True); log=logs/f"issue-{n}.log"
    if branch_exists(root,branch):
        state["processed"][str(n)]={"status":"skipped-existing-branch","branch":branch,"time":int(time.time())}; save_state(state_path,state); comment(repo,n,f"Bridge refused to re-run because `{branch}` already exists. Create a new `[OC]` issue for a revision."); return
    run(["git","fetch","--prune","origin","main"],cwd=root)
    if wt.exists(): run(["git","worktree","remove","--force",str(wt)],cwd=root,check=False)
    wt.parent.mkdir(parents=True,exist_ok=True); run(["git","worktree","add","-b",branch,str(wt),"origin/main"],cwd=root)
    comment(repo,n,f"VITROS bridge accepted this task. OpenCode is executing on `{branch}`. Nothing will merge automatically.")
    cmd=[os.getenv("OPENCODE_BIN","opencode"),"run","--dir",str(wt),"--auto","--format","json","--title",f"VITROS issue #{n}"]
    if os.getenv("OPENCODE_MODEL","").strip(): cmd += ["--model",os.getenv("OPENCODE_MODEL","").strip()]
    if os.getenv("OPENCODE_AGENT","").strip(): cmd += ["--agent",os.getenv("OPENCODE_AGENT","").strip()]
    if os.getenv("OPENCODE_ATTACH_URL","").strip(): cmd += ["--attach",os.getenv("OPENCODE_ATTACH_URL","").strip()]
    cmd.append(build_prompt(i)); env=os.environ.copy(); rg=shutil.which("git"); rh=shutil.which("gh")
    if not rg or not rh: raise BridgeError("Cannot locate real git/gh binaries.")
    env["BRIDGE_REAL_GIT"]=rg; env["BRIDGE_REAL_GH"]=rh; env["PATH"]=f"{wt/'bridge'/'safe-bin'}:{env.get('PATH','')}"; env["GIT_TERMINAL_PROMPT"]="0"
    p=run(cmd,cwd=wt,check=False,env=env); log.write_text(f"$ {shlex.join(cmd[:-1])} <PROMPT>\n\nexit={p.returncode}\n\nSTDOUT\n{p.stdout or ''}\n\nSTDERR\n{p.stderr or ''}\n"); os.chmod(log,0o600)
    if p.returncode!=0:
        state["processed"][str(n)]={"status":"opencode-failed","branch":branch,"log":str(log),"time":int(time.time())}; save_state(state_path,state); comment(repo,n,f"OpenCode exited with code `{p.returncode}`. No PR was created. Detailed log remains local at `{log}`."); return
    if not run(["git","status","--porcelain"],cwd=wt).stdout.strip():
        state["processed"][str(n)]={"status":"no-changes","branch":branch,"log":str(log),"time":int(time.time())}; save_state(state_path,state); comment(repo,n,"OpenCode completed but produced no repository changes, so no PR was created."); return
    if run(["git","diff","--check"],cwd=wt,check=False).returncode!=0:
        state["processed"][str(n)]={"status":"diff-check-failed","branch":branch,"log":str(log),"time":int(time.time())}; save_state(state_path,state); comment(repo,n,"OpenCode produced changes but `git diff --check` failed. No PR was created."); return
    run(["git","add","-A"],cwd=wt); stat=run(["git","diff","--cached","--stat"],cwd=wt).stdout.strip(); run(["git","commit","-m",f"oc: implement issue #{n}"],cwd=wt); run(["git","push","-u","origin",branch],cwd=wt)
    body=f"Generated by the VITROS ChatGPT ↔ OpenCode bridge for issue #{n}.\n\nCloses #{n}\n\n### Bridge verification\n- `git diff --check`: PASS\n- OpenCode log retained locally\n- Auto-merge: DISABLED\n\n### Changed files\n```\n{stat}\n```\n"
    pr=run(["gh","pr","create","--repo",repo,"--base","main","--head",branch,"--title",short or f"OpenCode issue #{n}","--body",body],cwd=wt); url=(pr.stdout or "").strip(); state["processed"][str(n)]={"status":"pr-created","branch":branch,"pr":url,"log":str(log),"time":int(time.time())}; save_state(state_path,state); comment(repo,n,f"OpenCode completed and created PR: {url}\n\n`git diff --check` passed. Review is required; the bridge never auto-merges.")
def bridge_once(root:Path,repo:str,state_path:Path,wtroot:Path):
    ensure_repo(root,repo); state=load_state(state_path); processed=state.setdefault("processed",{})
    for i in list_tasks(repo):
        if str(i["number"]) in processed: continue
        try: process(root,repo,i,state,state_path,wtroot)
        except Exception as e:
            processed[str(i["number"])]={"status":"bridge-error","error":str(e),"time":int(time.time())}; save_state(state_path,state)
            try: comment(repo,int(i["number"]),f"Bridge failed before PR creation. Error: `{str(e)[:1000]}`")
            except Exception: pass
def main()->int:
    ap=argparse.ArgumentParser(); ap.add_argument("--repo",default=os.getenv("BRIDGE_REPO",DEFAULT_REPO)); ap.add_argument("--root",default=os.getenv("BRIDGE_ROOT","")); ap.add_argument("--interval",type=int,default=int(os.getenv("BRIDGE_POLL_SECONDS","60"))); ap.add_argument("--once",action="store_true"); a=ap.parse_args()
    root=Path(a.root).expanduser().resolve() if a.root else Path(__file__).resolve().parent.parent; key=repo_key(a.repo); state=Path(os.getenv("BRIDGE_STATE_FILE",f"~/.local/state/joeos-opencode-bridge/{key}/processed.json")).expanduser(); wt=Path(os.getenv("BRIDGE_WORKTREE_ROOT",f"~/.cache/joeos-opencode-bridge/{key}/worktrees")).expanduser(); lock=state.parent/"bridge.lock"; lock.parent.mkdir(parents=True,exist_ok=True)
    with lock.open("w") as f:
        try: fcntl.flock(f.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: print("Another VITROS bridge runner is already active.",file=sys.stderr); return 2
        while True:
            try: bridge_once(root,a.repo,state,wt)
            except Exception as e: print(f"[bridge] {e}",file=sys.stderr)
            if a.once:return 0
            time.sleep(max(a.interval,30))
if __name__=="__main__": raise SystemExit(main())
