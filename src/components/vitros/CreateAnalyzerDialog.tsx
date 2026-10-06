import { useAction } from 'convex/react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { theme } from './SharedComponents';
import { remInputStyle } from './RemProgressDialog';

const VITROS_MODELS = ['3600', '5600', '7600'] as const;
const VISION_SERIAL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const MAX_ORDER = 1_000_000;

export function CreateAnalyzerDialog({ family, onClose, onSaved }: { family: 'VITROS' | 'VISION'; onClose: () => void; onSaved: (r: { id: string; title: string }) => void }) {
  const directory = useAction(api.remProgressActions.listEngineers);
  const create = useAction(api.remProgressActions.createAnalyzer);
  const [engineers, setEngineers] = useState<{ id: string; name: string; initials: string }[]>([]);
  const [directoryError, setDirectoryError] = useState('');
  const [model, setModel] = useState<string>(VITROS_MODELS[0]);
  const [serialNumber, setSerial] = useState('');
  const [productionOrder, setProductionOrder] = useState('');
  const [engineerId, setEngineer] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<Parameters<typeof create>[0] | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    let alive = true;
    void directory().then(r => { if (alive) setEngineers(r); }).catch(() => { if (alive) setDirectoryError('Unable to load active engineers'); });
    return () => { alive = false; };
  }, [directory]);

  const serial = serialNumber.trim();
  const order = productionOrder.trim();
  const orderNumber = order === '' ? null : Number(order);
  const serialValid = family === 'VISION' ? VISION_SERIAL.test(serial) : /^\d{8}$/.test(serial) && serial.startsWith(model);
  const orderValid = order === '' || (orderNumber !== null && Number.isInteger(orderNumber) && orderNumber >= 0 && orderNumber <= MAX_ORDER);
  const valid = serialValid && orderValid && !!engineerId && !directoryError;

  async function save() {
    if (saving.current || !valid) return;
    saving.current = true; setBusy(true); setError('');
    try {
      pending.current ??= { family, serialNumber: serial, analyzerType: family === 'VISION' ? 'VISION' : model, productionOrder: orderNumber, engineerId, notes, correlationId: `analyzer-create:${crypto.randomUUID()}` };
      const result = await create(pending.current);
      onSaved({ id: result.record.id, title: result.record.serialNumber });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to register analyzer');
    } finally {
      saving.current = false; setBusy(false);
    }
  }

  return <Dialog open onOpenChange={o => { if (!o && !busy) onClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto" style={{ backgroundColor: theme.pageBg, color: theme.textPrimary }}><DialogHeader><DialogTitle>Register {family} analyzer</DialogTitle><DialogDescription>Enter the serial number and select the engineer registering this analyzer. Progress starts unreported.</DialogDescription></DialogHeader>
      <fieldset disabled={busy || !!pending.current} className="space-y-3">
        {family === 'VITROS' && <label className="block text-sm">Model<select aria-label="Model" value={model} onChange={e => setModel(e.target.value)} className="block p-2 w-full rounded-lg mt-1" style={remInputStyle}>{VITROS_MODELS.map(m => <option key={m} value={m}>{m}</option>)}</select></label>}
        <label className="block text-sm">Serial number<input maxLength={120} value={serialNumber} onChange={e => setSerial(e.target.value)} className="block p-2 w-full rounded-lg mt-1" style={remInputStyle} placeholder={family === 'VISION' ? 'Alphanumeric, dash, underscore or dot' : `8 digits starting with ${model}`}/></label>
        <label className="block text-sm">Production order (optional)<input type="number" min={0} max={MAX_ORDER} step={1} value={productionOrder} onChange={e => setProductionOrder(e.target.value)} className="block p-2 w-full rounded-lg mt-1" style={remInputStyle}/></label>
        <label className="block text-sm">Engineer (required)<select aria-label="Engineer" value={engineerId} onChange={e => setEngineer(e.target.value)} className="block p-2 w-full rounded-lg mt-1" style={remInputStyle}><option value="">Select engineer…</option>{engineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <label className="block text-sm">Notes<textarea maxLength={4000} value={notes} onChange={e => setNotes(e.target.value)} className="block p-2 w-full rounded-lg mt-1" style={remInputStyle}/></label>
      </fieldset>
      {directoryError && <div role="alert">{directoryError}</div>}
      {error && <div role="alert">{error}<button className="block underline" onClick={() => { pending.current = null; setError(''); }}>Edit request</button></div>}
      <button className="rounded-lg bg-indigo-600 text-white p-3 disabled:opacity-40" disabled={busy || !valid} onClick={() => void save()}>{busy ? 'Registering…' : pending.current ? 'Retry registration' : 'Register analyzer'}</button>
  </DialogContent></Dialog>;
}
