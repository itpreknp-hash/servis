'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Plus, X, Edit3, Send, Search, Printer, Calendar, User, Phone, Trash2, Settings, MessageSquare
} from 'lucide-react'; // Popravljen import ovde

// --- INTERFACES ---
interface Customer { id: string; ime: string; broj_telefona: string; }
interface Device { id: string; brand: string; model: string; imei?: string | null; }

interface Order {
  id: string;
  created_at: string;
  status: string;
  opis_problema: string;
  rok_zavrsetka?: string | null;
  customers: Customer;
  devices: Device;
}

type ModalMode = 'new' | 'edit' | 'templates' | '';

export default function ServisDashboard() {
  // --- STATE ---
  const [orders, setOrders] = useState<Order[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState<ModalMode>('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string>('Mobilni Servis Šabac');

  const [newOrder, setNewOrder] = useState({
    ime: '', broj: '', brand: '', model: '', imei: '', opis: '', rok: ''
  });

  const [templates, setTemplates] = useState<Record<string, string>>({
    primljen: `📱 Primljeno na servis!\nKorisnik: {{ime}}\nModel: {{brand}} {{model}}\nIMEI: {{imei}}\nProblem: {{opis}}\nRok: {{rok}}\n\nHvala!\n{{company}}`,
    neuspeh: `⚠️ Nažalost, popravka uređaja {{brand}} {{model}} (IMEI: {{imei}}) nije uspela.\n{{company}}`,
    zavrsen: `✅ Popravka završena! {{brand}} {{model}} (IMEI: {{imei}}) spreman za preuzimanje.\n{{company}}`
  });

  const previewCtx = {
    ime: 'Petar Petrović',
    brand: 'Samsung',
    model: 'A52',
    imei: '123456789012345',
    rok: '01.02.2026',
    opis: 'Ne pali ekran',
    order_id: 'ABC12345'
  };

  // --- EFFECTS ---
  useEffect(() => {
    fetchOrders();
    fetchTemplates();
  }, []);

  useEffect(() => {
    const filtered = orders.filter(order =>
      order.customers.ime.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.devices.brand.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.devices.model.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (order.devices.imei?.toLowerCase() || '').includes(searchTerm.toLowerCase())
    );
    setFilteredOrders(filtered);
  }, [searchTerm, orders]);

  // --- API FUNCTIONS ---
  const fetchOrders = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, created_at, status, opis_problema, rok_zavrsetka,
          customers(id, ime, broj_telefona),
          devices(id, brand, model, imei)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const rawData = (data || []) as any[];
      const mapped: Order[] = rawData.map((row) => {
        const custRaw = Array.isArray(row.customers) ? row.customers[0] : row.customers;
        const devRaw = Array.isArray(row.devices) ? row.devices[0] : row.devices;

        return {
          id: row.id,
          created_at: row.created_at,
          status: row.status,
          opis_problema: row.opis_problema,
          rok_zavrsetka: row.rok_zavrsetka,
          customers: custRaw || { id: '', ime: 'Nepoznato', broj_telefona: '' },
          devices: devRaw || { id: '', brand: '', model: '', imei: '' }
        };
      });

      setOrders(mapped);
      setFilteredOrders(mapped);
    } catch (err) {
      console.error('fetchOrders error', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTemplates = async () => {
    try {
      const { data, error } = await supabase.from('wa_templates').select('status, message');
      if (error) return;
      if (data && data.length) {
        const map: Record<string, string> = {};
        data.forEach((t: any) => {
          if (t.status === 'company') setCompanyName(t.message);
          else map[t.status] = t.message;
        });
        setTemplates(prev => ({ ...prev, ...map }));
      }
    } catch (err) { console.warn('Templates fetch error:', err); }
  };

  const saveTemplates = async () => {
    try {
      const payload = [
        ...Object.entries(templates).map(([status, message]) => ({ status, message })),
        { status: 'company', message: companyName }
      ];
      await supabase.from('wa_templates').upsert(payload, { onConflict: 'status' });
      setShowModal('');
      alert('✅ Podešavanja sačuvana!');
    } catch (err) { alert('Greška pri čuvanju.'); }
  };

  const replacePlaceholders = (template: string, ctx: any) => {
    if (!template) return '';
    return template
      .replace(/{{\s*ime\s*}}/gi, ctx.ime || '')
      .replace(/{{\s*brand\s*}}/gi, ctx.brand || '')
      .replace(/{{\s*model\s*}}/gi, ctx.model || '')
      .replace(/{{\s*imei\s*}}/gi, ctx.imei || 'N/A')
      .replace(/{{\s*rok\s*}}/gi, ctx.rok || '')
      .replace(/{{\s*opis\s*}}/gi, ctx.opis || '')
      .replace(/{{\s*order_id\s*}}/gi, ctx.order_id || '')
      .replace(/{{\s*company\s*}}/gi, companyName);
  };

const sendWhatsApp = async (broj: string, poruka: string) => {
  try {
    // Provera pre slanja
    if (!broj || !poruka) return;

    await fetch('/api/wa/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        broj: broj, // Mora biti string (npr. "38165...")
        poruka: poruka 
      })
    });
  } catch (error) {
    console.error('Greška pri slanju:', error);
  }
};

  const changeStatus = async (orderId: string, newStatus: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    try {
      const { error } = await supabase.from('orders').update({ status: newStatus }).eq('id', orderId);
      if (error) throw error;

      const poruka = replacePlaceholders(templates[newStatus] || '', {
        ime: order.customers.ime,
        brand: order.devices.brand,
        model: order.devices.model,
        imei: order.devices.imei,
        rok: order.rok_zavrsetka ? new Date(order.rok_zavrsetka).toLocaleDateString('sr-RS') : 'uskoro',
        order_id: order.id.slice(-8)
      });

      if (poruka) await sendWhatsApp(order.customers.broj_telefona, poruka);
      fetchOrders();
    } catch (err) { 
      alert('Greška pri promeni statusa'); 
    }
  };

  const createOrUpdateOrder = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newOrder.ime || !newOrder.broj) return alert('Ime i broj su obavezni!');

    try {
      let customerId;
      const { data: existing } = await supabase.from('customers').select('id').eq('broj_telefona', newOrder.broj.trim()).single();
      
      if (existing) {
        customerId = existing.id;
        await supabase.from('customers').update({ ime: newOrder.ime }).eq('id', customerId);
      } else {
        const { data: newC, error: cErr } = await supabase.from('customers').insert({ ime: newOrder.ime, broj_telefona: newOrder.broj }).select().single();
        if (cErr) throw cErr;
        customerId = newC.id;
      }

      if (selectedOrder) {
        await supabase.from('devices').update({ brand: newOrder.brand, model: newOrder.model, imei: newOrder.imei }).eq('id', selectedOrder.devices.id);
        await supabase.from('orders').update({ customer_id: customerId, opis_problema: newOrder.opis, rok_zavrsetka: newOrder.rok || null }).eq('id', selectedOrder.id);
      } else {
        const { data: dev, error: dErr } = await supabase.from('devices').insert({ customer_id: customerId, brand: newOrder.brand, model: newOrder.model, imei: newOrder.imei }).select().single();
        if (dErr) throw dErr;
        await supabase.from('orders').insert({ customer_id: customerId, device_id: dev.id, opis_problema: newOrder.opis, rok_zavrsetka: newOrder.rok || null, status: 'primljen' });
        
        const msg = replacePlaceholders(templates.primljen, { ...newOrder, company: companyName });
        await sendWhatsApp(newOrder.broj, msg);
      }

      setShowModal('');
      fetchOrders();
    } catch (err) { alert('Greška pri čuvanju.'); }
  };

  const deleteOrder = async (id: string) => {
    if (confirm('Trajno obrisati?')) {
      await supabase.from('orders').delete().eq('id', id);
      fetchOrders();
    }
  };

  const printRecept = (order: Order) => {
    const content = `
      ${companyName}\n===================\n
      Korisnik: ${order.customers.ime}\n
      Uređaj: ${order.devices.brand} ${order.devices.model}\n
      IMEI: ${order.devices.imei || 'N/A'}\n
      Problem: ${order.opis_problema}\n
      Status: ${order.status.toUpperCase()}\n
      Datum: ${new Date().toLocaleDateString('sr-RS')}\n
      Br. naloga: #${order.id.slice(-8).toUpperCase()}\n
      ===================\nHvala na poverenju!
    `;
    const win = window.open('', '_blank');
    win?.document.write(`<html><body onload="window.print();window.close()"><pre style="font-family:monospace;font-size:12px">${content}</pre></body></html>`);
  };

  const stats = {
    ukupno: orders.length,
    primljeno: orders.filter(o => o.status === 'primljen').length,
    zavrseno: orders.filter(o => o.status === 'zavrsen').length,
    neuspeh: orders.filter(o => o.status === 'neuspeh').length,
  };

  if (loading) return <div className="flex items-center justify-center min-h-screen">Učitavanje...</div>;

  return (
    <div className="min-h-screen bg-[#f8fafc] p-4 md:p-8 font-sans text-slate-900">
      <div className="max-w-6xl mx-auto">
        
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-indigo-950 uppercase">{companyName}</h1>
            <p className="text-slate-500 font-medium">Servisni Panel v2.0</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setShowModal('templates')} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-600 hover:bg-slate-50 transition shadow-sm">
              <Settings size={20} />
            </button>
            <button onClick={() => { setSelectedOrder(null); setNewOrder({ ime: '', broj: '', brand: '', model: '', imei: '', opis: '', rok: '' }); setShowModal('new'); }} 
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-2xl flex items-center gap-2 shadow-lg shadow-indigo-200 transition-all active:scale-95 font-bold">
              <Plus size={22} /> NOVI NALOG
            </button>
          </div>
        </header>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Ukupno', val: stats.ukupno, bg: 'bg-white', txt: 'text-slate-800' },
            { label: 'Na servisu', val: stats.primljeno, bg: 'bg-amber-500', txt: 'text-white' },
            { label: 'Završeno', val: stats.zavrseno, bg: 'bg-emerald-500', txt: 'text-white' },
            { label: 'Neuspeh', val: stats.neuspeh, bg: 'bg-rose-500', txt: 'text-white' }
          ].map((s, i) => (
            <div key={i} className={`${s.bg} p-6 rounded-3xl shadow-sm border border-slate-100 transition-transform hover:scale-[1.02]`}>
              <p className={`text-[10px] font-black uppercase tracking-[0.2em] mb-1 ${s.txt === 'text-white' ? 'opacity-80' : 'text-slate-400'}`}>{s.label}</p>
              <p className={`text-3xl font-black ${s.txt}`}>{s.val}</p>
            </div>
          ))}
        </div>

        <div className="relative mb-8 group">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" size={22} />
          <input 
            type="text" 
            placeholder="Pretraga klijenata, modela ili IMEI brojeva..." 
            className="w-full pl-14 pr-6 py-5 bg-white rounded-3xl border-none shadow-sm focus:ring-4 focus:ring-indigo-100 outline-none transition-all text-lg"
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="space-y-4">
          {filteredOrders.map(order => (
            <div key={order.id} className={`bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden transition-all ${expandedOrderId === order.id ? 'ring-2 ring-indigo-500' : ''}`}>
              <div className="p-6 flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex-1 cursor-pointer w-full" onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}>
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-xl font-bold text-slate-800">{order.customers.ime}</h3>
                    <span className={`px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                      order.status === 'zavrsen' ? 'bg-emerald-100 text-emerald-700' : 
                      order.status === 'neuspeh' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {order.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm font-medium text-slate-500">
                    <span className="flex items-center gap-2"><Phone size={16} className="text-indigo-400"/> {order.customers.broj_telefona}</span>
                    <span className="flex items-center gap-2 text-slate-800 underline decoration-indigo-200 decoration-2 underline-offset-4">{order.devices.brand} {order.devices.model}</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-2xl">
                  <button onClick={() => changeStatus(order.id, 'zavrsen')} className="p-3 bg-white text-emerald-600 rounded-xl hover:shadow-md transition active:scale-90" title="Završi"><Send size={20}/></button>
                  <button onClick={() => changeStatus(order.id, 'neuspeh')} className="p-3 bg-white text-rose-600 rounded-xl hover:shadow-md transition active:scale-90" title="Neuspeh"><X size={20}/></button>
                  <button onClick={() => { setSelectedOrder(order); setNewOrder({ ime: order.customers.ime, broj: order.customers.broj_telefona, brand: order.devices.brand, model: order.devices.model, imei: order.devices.imei || '', opis: order.opis_problema, rok: order.rok_zavrsetka?.split('T')[0] || '' }); setShowModal('edit'); }} className="p-3 bg-white text-indigo-600 rounded-xl hover:shadow-md transition active:scale-90"><Edit3 size={20}/></button>
                  <button onClick={() => printRecept(order)} className="p-3 bg-white text-slate-600 rounded-xl hover:shadow-md transition active:scale-90"><Printer size={20}/></button>
                  <button onClick={() => deleteOrder(order.id)} className="p-3 bg-white text-slate-400 hover:text-rose-600 rounded-xl transition active:scale-90"><Trash2 size={20}/></button>
                </div>
              </div>

              {expandedOrderId === order.id && (
                <div className="px-8 pb-8 pt-4 bg-indigo-50/30 border-t border-indigo-50">
                  <div className="grid md:grid-cols-2 gap-8">
                    <div className="bg-white p-6 rounded-2xl shadow-sm">
                      <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-3">Opis Kvara</p>
                      <p className="text-slate-700 leading-relaxed font-medium">{order.opis_problema}</p>
                    </div>
                    <div className="space-y-4 text-sm">
                      <p className="flex justify-between border-b pb-2"><span className="text-slate-400">IMEI:</span> <b>{order.devices.imei || 'Nema'}</b></p>
                      <p className="flex justify-between border-b pb-2"><span className="text-slate-400">Rok:</span> <b>{order.rok_zavrsetka ? new Date(order.rok_zavrsetka).toLocaleDateString('sr-RS') : 'Nema'}</b></p>
                      <p className="flex justify-between border-b pb-2"><span className="text-slate-400">Prijem:</span> <b>{new Date(order.created_at).toLocaleDateString('sr-RS')}</b></p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* NEW/EDIT MODAL */}
      {(showModal === 'new' || showModal === 'edit') && (
        <div className="fixed inset-0 bg-indigo-950/40 backdrop-blur-md flex items-center justify-center p-4 z-50 text-sm">
          <div className="bg-white rounded-[2.5rem] w-full max-w-2xl overflow-hidden shadow-2xl">
            <div className="p-8 border-b flex justify-between items-center bg-slate-50/50">
              <h2 className="text-2xl font-black text-indigo-950">{showModal === 'new' ? 'Novi Servisni Nalog' : 'Izmena Naloga'}</h2>
              <button onClick={() => setShowModal('')} className="p-3 hover:bg-white rounded-2xl transition shadow-sm"><X/></button>
            </div>
            <form onSubmit={createOrUpdateOrder} className="p-8 space-y-5">
              <div className="grid grid-cols-2 gap-5">
                <input value={newOrder.ime} placeholder="Ime klijenta" className="w-full p-4 bg-slate-100 rounded-2xl outline-none" required onChange={e => setNewOrder({...newOrder, ime: e.target.value})} />
                <input value={newOrder.broj} placeholder="3816..." className="w-full p-4 bg-slate-100 rounded-2xl outline-none" required onChange={e => setNewOrder({...newOrder, broj: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-5">
                <input value={newOrder.brand} placeholder="Marka" className="w-full p-4 bg-slate-100 rounded-2xl outline-none" required onChange={e => setNewOrder({...newOrder, brand: e.target.value})} />
                <input value={newOrder.model} placeholder="Model" className="w-full p-4 bg-slate-100 rounded-2xl outline-none" required onChange={e => setNewOrder({...newOrder, model: e.target.value})} />
              </div>
              <textarea value={newOrder.opis} placeholder="Opis problema" className="w-full p-4 bg-slate-100 rounded-2xl outline-none h-32 resize-none" required onChange={e => setNewOrder({...newOrder, opis: e.target.value})} />
              <div className="grid grid-cols-2 gap-5">
                <input value={newOrder.imei} placeholder="IMEI" className="w-full p-4 bg-slate-100 rounded-2xl outline-none" onChange={e => setNewOrder({...newOrder, imei: e.target.value})} />
                <input type="date" value={newOrder.rok} className="w-full p-4 bg-slate-100 rounded-2xl outline-none" onChange={e => setNewOrder({...newOrder, rok: e.target.value})} />
              </div>
              <button type="submit" className="w-full bg-indigo-600 text-white py-5 rounded-[1.5rem] font-black text-lg hover:bg-indigo-700 transition shadow-xl mt-4 uppercase">
                {showModal === 'new' ? 'Zavedi Nalog' : 'Sačuvaj Izmene'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TEMPLATES MODAL */}
      {showModal === 'templates' && (
        <div className="fixed inset-0 bg-indigo-950/40 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-[2.5rem] w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl p-8">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-black text-indigo-950 uppercase">Podešavanja</h2>
              <button onClick={() => setShowModal('')} className="p-3 hover:bg-slate-100 rounded-2xl transition"><X/></button>
            </div>
            <div className="space-y-6">
              <input value={companyName} className="w-full p-4 bg-slate-50 border-2 rounded-2xl font-bold" onChange={e => setCompanyName(e.target.value)} />
              <div className="grid md:grid-cols-2 gap-6">
                {['primljen', 'zavrsen', 'neuspeh'].map((key) => (
                  <div key={key} className="space-y-2">
                    <label className="text-xs font-black text-indigo-400 uppercase tracking-widest">Poruka: {key}</label>
                    <textarea value={templates[key]} className="w-full p-4 bg-slate-50 border-2 rounded-2xl h-40 text-sm" onChange={e => setTemplates({...templates, [key]: e.target.value})} />
                  </div>
                ))}
              </div>
              <button onClick={saveTemplates} className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-black text-lg shadow-xl uppercase">Sačuvaj</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}