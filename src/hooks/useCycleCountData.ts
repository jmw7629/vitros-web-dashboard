import {useAction,useConvexAuth,useQuery} from "convex/react";
import {useCallback,useEffect,useRef,useState} from "react";
import {api} from "../../convex/_generated/api";
import type {CycleSchedule,CycleResult} from "./useConvexData";
import type {CycleWip} from "../../convex/cycleCountContract";
const emptyWip:CycleWip={serials:[],parts:[],fingerprint:"",unmatchedParts:0,loadedAt:0};
export function useCycleCountData() {
 const {isAuthenticated}=useConvexAuth();const user=useQuery(api.auth.currentUser,isAuthenticated?{}:"skip");
 const identity=user?String(user._id):null;const current=useRef(identity);current.current=identity;
 const pulse=useQuery(api.realtimePulse.watch,identity?{}:"skip");
 const load=useAction(api.cycleCountActions.loadData);
 const [state,setState]=useState<{schedules:CycleSchedule[];results:CycleResult[];wip:CycleWip;moreHistory:boolean}>({schedules:[],results:[],wip:emptyWip,moreHistory:false});
 const [error,setError]=useState<string|null>(null);const [loading,setLoading]=useState(true);const mounted=useRef(false);const pending=useRef<Promise<void>|null>(null);
 const refresh=useCallback(()=>{
  if(!identity)return Promise.resolve();
  if(pending.current)return pending.current;
  const expected=identity;
  const request=load({}).then(result=>{if(mounted.current&&current.current===expected){setState(result);setError(null);setLoading(false);}}).catch(err=>{if(mounted.current&&current.current===expected){setError(err instanceof Error?err.message:"Could not refresh Cycle Count");setLoading(false);}});
  pending.current=request;void request.finally(()=>{if(pending.current===request)pending.current=null;});return request;
 },[identity,load]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{pending.current=null;setState({schedules:[],results:[],wip:emptyWip,moreHistory:false});setError(null);setLoading(Boolean(identity));void refresh();},[identity,refresh]);
 useEffect(()=>{if(identity)void refresh();},[pulse?.version,identity,refresh]);
 useEffect(()=>{if(!identity)return;const timer=setInterval(()=>void refresh(),10000);return()=>clearInterval(timer);},[identity,refresh]);
 return {...state,error,loading,refresh,setWip:(wip:CycleWip)=>setState(previous=>({...previous,wip}))};
}
export function useCycleScheduleMutation() {
 const mutate=useAction(api.cycleCountActions.mutateSchedule);
 return useCallback((fn:string,payload:Record<string,unknown>)=>mutate({operation:fn.replace("cycleCount:","") as "createSchedule"|"updateSchedule"|"deleteSchedule"|"deleteResult",payload,correlationId:crypto.randomUUID()}),[mutate]);
}
