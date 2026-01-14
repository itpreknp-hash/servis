'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Plus, X, Edit3, Send, Search, Printer, Calendar, User, Phone
} from 'lucide-react';

interface Customer { id: string; ime: string; broj_telefona: string; }
interface Device { id: string; brand: string; model: string; imei?: string; }
interface Order {
  id: string;
  created_at: string;
  status: string;
  opis_problema: string;
  rok_zavrsetka?: string;
  customers: Customer;
  devices: Device;
}

type ModalMode = 'new' | 'recept' | 'edit' | 'templates' | '';

export default function ServisDashboard() {
  // --- state / hooks (declare all at top to keep hooks order stable) ---
  const [orders, setOrders] = useState<Order[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState<ModalMode>('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [newOrder, setNewOrder] = useState({
    ime: '', broj: '', brand: '', model: '', imei: '', opis: '', rok: ''
  });
  const [searchTerm, setSearchTerm] = useState('');

  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  // company name used in templates and printing
  const [companyName, setCompanyName] = useState<string>('Mobilni Servis Šabac');

  // templates (contain {{company}} placeholder; in JSX we always escape)
  const [templates, setTemplates] = useState<Record<string, string>>({
    primljen: `📱 Primljeno na servis!
Korisnik: {{ime}}
Model: {{brand}} {{model}}
IMEI: {{imei}}
Problem: {{opis}}
Rok: {{rok}}

Hvala!
{{company}}`,
    neuspeh: `⚠️ Nažalost, popravka uređaja {{brand}} {{model}} (IMEI: {{imei}}) nije uspela. Kontaktiraćemo vas za dalji postupak.
{{company}}`,
    zavrsen: `✅ Popravka završena! {{brand}} {{model}} (IMEI: {{imei}}) spreman za preuzimanje.
{{company}}`
  });

  const [previewCtx, setPreviewCtx] = useState({
    ime: 'Petar Petrović',
    brand: 'Samsung',
    model: 'A52',
    imei: '123456789012345',
    rok: '01.02.2026',
    opis: 'Ne pali ekran',
    order_id: 'ABC12345'
  });

  // --- effects ---
  useEffect(() => {
    if (showModal === 'new') {
      const today = new Date().toISOString().split('T')[0];
      setNewOrder({ ime: '', broj: '', brand: '', model: '', imei: '', opis: '', rok: today });
      setSelectedOrder(null);
    }
  }, [showModal]);

  useEffect(() => {
    fetchOrders();
    fetchTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // keep a no-op effect to preserve hook order stability (safe)
  useEffect(() => {
    const handler = () => {};
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  // --- helpers / API ---
  const fetchOrders = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('orders')
      .select(`
        id, created_at, status, opis_problema, rok_zavrsetka,
        customers(id, ime, broj_telefona),
        devices(id, brand, model, imei)
      `)
      .order('created_at', { ascending: false });
    setOrders(data || []);
    setFilteredOrders(data || []);
    setLoading(false);
  };

  const fetchTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from('wa_templates')
        .select('status, message');

      if (error) {
        // table may not exist — keep defaults
        console.warn('Templates fetch error (ok to ignore if table missing):', error.message);
        return;
      }

      if (data && data.length) {
        const map: Record<string, string> = {};
        data.forEach((t: any) => {
          if (t.status === 'company') {
            if (t.message) setCompanyName(t.message);
          } else {
            map[t.status] = t.message;
          }
        });
        setTemplates(prev => ({ ...prev, ...map }));
      } else {
        await ensureDefaultTemplatesInDB();
      }
    } catch (err) {
      console.error('fetchTemplates error', err);
    }
  };

  const ensureDefaultTemplatesInDB = async () => {
    try {
      const payload = Object.entries({ ...templates, company: companyName }).map(([status, message]) => ({ status, message }));
      await supabase.from('wa_templates').upsert(payload, { onConflict: ['status'] });
    } catch (err) {
      console.warn('Could not create default templates in DB:', err);
    }
  };

  const replacePlaceholders = (template: string, ctx: { ime?: string; brand?: string; model?: string; imei?: string; rok?: string; opis?: string; status?: string; order_id?: string }) => {
    return template
      .replace(/{{\s*ime\s*}}/gi, ctx.ime || '')
      .replace(/{{\s*brand\s*}}/gi, ctx.brand || '')
      .replace(/{{\s*model\s*}}/gi, ctx.model || '')
      .replace(/{{\s*imei\s*}}/gi, ctx.imei || 'N/A')
      .replace(/{{\s*rok\s*}}/gi, ctx.rok || '')
      .replace(/{{\s*opis\s*}}/gi, ctx.opis || '')
      .replace(/{{\s*status\s*}}/gi, ctx.status || '')
      .replace(/{{\s*order_id\s*}}/gi, ctx.order_id || '')
      .replace(/{{\s*company\s*}}/gi, companyName || '');
  };

  const sendWhatsApp = async (broj: string, poruka: string) => {
    try {
      await fetch('/api/wa/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broj, poruka })
      });
    } catch (error) {
      console.error('WhatsApp error:', error);
    }
  };

  // --- REPLACED changeStatus: optimistic update + WA send + error handling ---
  const changeStatus = async (orderId: string, newStatus: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const tpl = templates[newStatus];
    const porukaFromTpl = tpl ? replacePlaceholders(tpl, {
      ime: order.customers.ime,
      brand: order.devices.brand,
      model: order.devices.model,
      imei: order.devices.imei || 'N/A',
      rok: order.rok_zavrsetka ? new Date(order.rok_zavrsetka).toLocaleDateString('sr-RS') : 'uskoro',
      status: newStatus,
      order_id: order.id.slice(-8)
    }) : '';

    let poruka = porukaFromTpl;
    if (!poruka) {
      if (newStatus === 'neuspeh') {
        poruka = `⚠️ Nažalost, popravka uređaja ${order.devices.brand} ${order.devices.model} (IMEI: ${order.devices.imei || 'N/A'}) nije uspela. Kontaktiraćemo vas.\n${companyName}`;
      } else if (newStatus === 'zavrsen') {
        poruka = `✅ Popravka završena! ${order.devices.brand} ${order.devices.model} (IMEI: ${order.devices.imei || 'N/A'}) spreman za preuzimanje.\n${companyName}`;
      }
    }

    // Save snapshots to allow revert
    const prevOrders = orders;
    const prevFiltered = filteredOrders;
    const prevSelected = selectedOrder;

    // Optimistic UI update
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
    setFilteredOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
    if (selectedOrder?.id === orderId) {
      setSelectedOrder({ ...selectedOrder, status: newStatus });
    }

    try {
      const res = await supabase
        .from('orders')
        .update({ status: newStatus })
        .eq('id', orderId)
        .select();

      console.log('Supabase update result:', res);
      // Normalize response
      const anyRes: any = res as any;
      if (anyRes.error) {
        // revert UI
        setOrders(prevOrders);
        setFilteredOrders(prevFiltered);
        if (prevSelected) setSelectedOrder(prevSelected);
        console.error('Supabase returned error:', anyRes.error);
        throw anyRes.error;
      }

      // send WA (if message)
      if (poruka) {
        try {
          await sendWhatsApp(order.customers.broj_telefona, poruka);
        } catch (waErr) {
          console.warn('WhatsApp send failed:', waErr);
          alert('Status je promenjen, ali slanje WhatsApp poruke nije uspelo. Proveri konzolu.');
        }
      }

      // Sync to be safe
      await fetchOrders();
    } catch (err: any) {
      // Revert UI
      setOrders(prevOrders);
      setFilteredOrders(prevFiltered);
      if (prevSelected) setSelectedOrder(prevSelected);

      console.error('changeStatus error detailed:', err);
      const errMsg = err?.message || err?.msg || JSON.stringify(err) || String(err);
      alert(`Greška pri promeni statusa: ${errMsg}. Pogledaj konzolu (network/console) za detalje.`);
      fetchOrders();
    }
  };

  const createOrUpdateOrder = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!newOrder.ime.trim() || !newOrder.broj.trim() || !newOrder.brand.trim() ||
      !newOrder.model.trim() || !newOrder.opis.trim()) {
      alert('❌ Popunite sva obavezna polja (*)');
      return;
    }

    try {
      // Find or create customer
      let customer;
      const { data: existingCustomer, error: fetchError } = await supabase
        .from('customers')
        .select('id, ime, broj_telefona')
        .eq('broj_telefona', newOrder.broj.trim())
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        throw new Error(`Greška pri proveri korisnika: ${fetchError.message}`);
      }

      if (existingCustomer) {
        if (selectedOrder && existingCustomer.id === selectedOrder.customers.id && existingCustomer.ime !== newOrder.ime.trim()) {
          await supabase.from('customers').update({ ime: newOrder.ime.trim() }).eq('id', existingCustomer.id);
        }
        customer = existingCustomer;
      } else {
        const { data: newCustomer, error: insertError } = await supabase
          .from('customers')
          .insert({
            ime: newOrder.ime.trim(),
            broj_telefona: newOrder.broj.trim()
          })
          .select('id, ime, broj_telefona')
          .single();

        if (insertError || !newCustomer) {
          throw new Error(`Greška pri kreiranju korisnika: ${insertError?.message}`);
        }
        customer = newCustomer;
      }

      if (selectedOrder) {
        // EDIT FLOW
        await supabase.from('devices').update({
          brand: newOrder.brand.trim(),
          model: newOrder.model.trim(),
          imei: newOrder.imei.trim() || null
        }).eq('id', selectedOrder.devices.id);

        await supabase.from('orders').update({
          customer_id: customer.id,
          opis_problema: newOrder.opis.trim(),
          rok_zavrsetka: newOrder.rok || null
        }).eq('id', selectedOrder.id);

        setShowModal('');
        setSelectedOrder(null);
        setNewOrder({ ime: '', broj: '', brand: '', model: '', imei: '', opis: '', rok: '' });
        fetchOrders();
        alert('✅ Nalog uspešno izmenjen!');
      } else {
        // CREATE FLOW
        const { data: device, error: deviceError } = await supabase
          .from('devices')
          .insert({
            customer_id: customer.id,
            brand: newOrder.brand.trim(),
            model: newOrder.model.trim(),
            imei: newOrder.imei.trim() || null
          })
          .select()
          .single();

        if (deviceError || !device) {
          throw new Error(`Greška pri kreiranju uređaja: ${deviceError?.message}`);
        }

        const { error: orderError } = await supabase
          .from('orders')
          .insert({
            customer_id: customer.id,
            device_id: device.id,
            opis_problema: newOrder.opis.trim(),
            rok_zavrsetka: newOrder.rok || null,
            status: 'primljen'
          });

        if (orderError) {
          throw new Error(`Greška pri kreiranju naloga: ${orderError.message}`);
        }

        // WhatsApp using template (primljen)
        const tpl = templates['primljen'];
        const poruka = tpl ? replacePlaceholders(tpl, {
          ime: newOrder.ime.trim(),
          brand: newOrder.brand.trim(),
          model: newOrder.model.trim(),
          imei: newOrder.imei.trim() || 'N/A',
          opis: newOrder.opis.trim(),
          rok: newOrder.rok ? new Date(newOrder.rok).toLocaleDateString('sr-RS') : 'uskoro',
          status: 'primljen',
          order_id: ''
        }) : `📱 Primljeno na servis!\nKorisnik: ${newOrder.ime.trim()}\nModel: ${newOrder.brand.trim()} ${newOrder.model.trim()}\nIMEI: ${newOrder.imei.trim() || 'N/A'}\nProblem: ${newOrder.opis.trim()}\nRok: ${newOrder.rok ? new Date(newOrder.rok).toLocaleDateString('sr-RS') : 'uskoro'}\n\nHvala!\n${companyName}`;

        await sendWhatsApp(newOrder.broj, poruka);

        setShowModal('');
        setNewOrder({ ime: '', broj: '', brand: '', model: '', imei: '', opis: '', rok: '' });
        fetchOrders();
        alert('✅ Nalog uspešno kreiran!');
      }
    } catch (error: any) {
      console.error('createOrUpdateOrder error:', error);
      alert(`❌ Greška: ${error?.message || error}`);
    }
  };

  const deleteOrder = async (orderId: string) => {
    if (!confirm('Da li ste sigurni da želite da obrišete ovaj nalog? Ova akcija se ne može poništiti.')) return;
    try {
      const { error } = await supabase.from('orders').delete().eq('id', orderId);
      if (error) throw error;
      fetchOrders();
      alert('✅ Nalog obrisan.');
    } catch (err: any) {
      console.error('deleteOrder error', err);
      alert(`❌ Greška pri brisanju: ${err.message || err}`);
    }
  };

  const saveTemplates = async (newTemplates: Record<string, string>) => {
    try {
      setTemplates(newTemplates);
      const payload = Object.entries({ ...newTemplates, company: companyName }).map(([status, message]) => ({ status, message }));
      await supabase.from('wa_templates').upsert(payload, { onConflict: ['status'] });
      setShowModal('');
      alert('✅ Poruke i naziv firme sačuvani.');
    } catch (err) {
      console.error('saveTemplates error', err);
      alert('❌ Greška pri čuvanju poruka.');
    }
  };

  const openEditModal = (order: Order) => {
    setSelectedOrder(order);
    setNewOrder({
      ime: order.customers.ime,
      broj: order.customers.broj_telefona,
      brand: order.devices.brand,
      model: order.devices.model,
      imei: order.devices.imei || '',
      opis: order.opis_problema,
      rok: order.rok_zavrsetka ? order.rok_zavrsetka.split('T')[0] : ''
    });
    setShowModal('edit');
  };

  const printRecept = (order: Order) => {
    const recept = `
${companyName}
===================
Korisnik: ${order.customers.ime}
Telefon: ${order.devices.brand} ${order.devices.model}
IMEI: ${order.devices.imei || 'N/A'}
Problem: ${order.opis_problema}
Status: ${order.status.toUpperCase()}
Datum: ${new Date().toLocaleDateString('sr-RS')}
Broj naloga: #${order.id.slice(-8)}
===================
Hvala na povjerenju!
${companyName}
`;
    const printWindow = window.open('', '_blank');
    printWindow?.document.write(`
      <html><head><title>Recept #${order.id.slice(-8)}</title>
      <style>body{font-family:Arial;font-size:14px;line-height:1.4;}</style></head>
      <body onload="window.print();window.close();">${recept.replace(/\n/g, '<br>')}</body></html>
    `);
  };

  const stats = {
    ukupno: orders.length,
    primljeno: orders.filter(o => o.status === 'primljen').length,
    neuspeh: orders.filter(o => o.status === 'neuspeh').length,
    zavrseno: orders.filter(o => o.status === 'zavrsen').length,
  };

  // helper to truncate long texts
  const truncate = (text: string, len = 90) => text.length > len ? text.slice(0, len).trim() + '…' : text;

  const previewFor = (statusKey: string) => replacePlaceholders(templates[statusKey] || '', previewCtx);

  // ---------- UI ----------
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p>Učitavanje naloga...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-blue-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">

        {/* Statistika */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gradient-to-br from-green-500 to-green-600 text-white p-4 rounded-xl shadow">
            <p className="text-sm opacity-90">Ukupno</p>
            <p className="text-2xl font-bold">{stats.ukupno}</p>
          </div>
          <div className="bg-gradient-to-br from-yellow-500 to-yellow-600 text-white p-4 rounded-xl shadow">
            <p className="text-sm opacity-90">Primljeno</p>
            <p className="text-2xl font-bold">{stats.primljeno}</p>
          </div>
          <div className="bg-gradient-to-br from-red-500 to-red-600 text-white p-4 rounded-xl shadow">
            <p className="text-sm opacity-90">Neuspeh</p>
            <p className="text-2xl font-bold">{stats.neuspeh}</p>
          </div>
          <div className="bg-gradient-to-br from-purple-500 to-purple-600 text-white p-4 rounded-xl shadow">
            <p className="text-sm opacity-90">Završeno</p>
            <p className="text-2xl font-bold">{stats.zavrseno}</p>
          </div>
        </div>

        {/* Search + actions */}
        <div className="flex flex-col sm:flex-row items-center gap-4 mb-6">
          <div className="relative flex-1 max-w-md w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Pretraga po imenu, marki, modelu ili IMEI..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-11 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white/60"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowModal('templates')}
              title="Uredi poruke i naziv firme"
              className="hidden sm:inline-flex items-center justify-center w-10 h-10 bg-gray-700 text-white rounded-lg"
            >
              ✉️
            </button>

            <button
              onClick={() => setShowModal('new')}
              className="flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white px-3 py-2 rounded-lg font-medium"
            >
              <Plus size={16} />
              Novi
            </button>
          </div>
        </div>

        {/* Orders */}
        <div className="space-y-3">
          {filteredOrders.length === 0 ? (
            <div className="text-center py-16 text-gray-500 rounded-lg border border-dashed border-gray-200">
              <Calendar size={56} className="mx-auto mb-4 opacity-40" />
              <h3 className="text-lg font-semibold mb-1">Nema naloga</h3>
              <p className="text-sm">Kliknite "Novi" da dodate nalog</p>
            </div>
          ) : (
            filteredOrders.map((order) => {
              const expanded = expandedOrderId === order.id;
              return (
                <div key={order.id} className={`bg-white rounded-xl shadow-sm border overflow-visible ${expanded ? 'ring-2 ring-indigo-100' : ''}`}>
                  <button
                    onClick={() => setExpandedOrderId(expanded ? null : order.id)}
                    className="w-full text-left p-4 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0 flex-1 flex items-center gap-3">
                      <div className="p-2 bg-gray-100 rounded-md flex items-center justify-center">
                        <User size={18} className="text-gray-700"/>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="font-semibold text-lg truncate">{order.customers.ime}</div>
                          <div className={`text-xs font-bold px-3 py-1 rounded-full ${
                            order.status === 'primljen' ? 'bg-yellow-100 text-yellow-800' :
                            order.status === 'neuspeh' ? 'bg-red-100 text-red-800' :
                            order.status === 'zavrsen' ? 'bg-green-100 text-green-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {order.status === 'primljen' ? 'Čekanje' :
                              order.status === 'neuspeh' ? 'Neuspeh' :
                              order.status === 'zavrsen' ? 'Završeno' :
                              order.status.toUpperCase()}
                          </div>
                        </div>

                        <div className="mt-1 text-sm text-gray-600 flex items-center gap-2">
                          <Phone size={14} className="text-gray-400" />
                          <div className="truncate">{order.customers.broj_telefona}</div>
                        </div>

                        <div className="mt-2 text-sm text-gray-600">
                          <div className="font-medium truncate">{order.devices.brand} {order.devices.model}
                            {order.devices.imei ? <span className="text-gray-500"> • IMEI: {order.devices.imei}</span> : null}
                          </div>
                          <div className="text-xs text-gray-500 mt-1 truncate">{truncate(order.opis_problema, 110)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-xs text-gray-400 hidden sm:block">{new Date(order.created_at).toLocaleDateString('sr-RS')}</div>
                      <div className="text-sm text-indigo-600 font-semibold">{expanded ? 'Sakrij' : 'Detalji'}</div>
                    </div>
                  </button>

                  {expanded && (
                    <div className="p-4 border-t bg-gray-50">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-2">
                          <div className="text-sm text-gray-700 mb-2"><strong>Opis problema:</strong></div>
                          <div className="text-sm text-gray-800 whitespace-pre-wrap mb-3">{order.opis_problema}</div>

                          <div className="flex flex-wrap gap-3 text-sm text-gray-600">
                            <div className="flex items-center gap-2"><strong>Telefon:</strong> <span className="text-gray-800">{order.devices.brand} {order.devices.model}</span></div>
                            {order.devices.imei && <div className="flex items-center gap-2"><strong>IMEI:</strong> <span className="text-gray-800">{order.devices.imei}</span></div>}
                            {order.rok_zavrsetka && <div className="flex items-center gap-2"><strong>Rok:</strong> <span className="text-gray-800">{new Date(order.rok_zavrsetka).toLocaleDateString('sr-RS')}</span></div>}
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-3">
                          <div className="flex items-center gap-2">
                            <button
                              title="Označi kao završeno"
                              onClick={() => changeStatus(order.id, 'zavrsen')}
                              className="w-9 h-9 flex items-center justify-center rounded-md bg-green-50 text-green-700 hover:bg-green-100"
                            >
                              <Send size={16} />
                            </button>

                            <button
                              title="Označi kao neuspeh"
                              onClick={() => changeStatus(order.id, 'neuspeh')}
                              className="w-9 h-9 flex items-center justify-center rounded-md bg-red-50 text-red-700 hover:bg-red-100"
                            >
                              <X size={16} />
                            </button>

                            <button
                              title="Izmeni nalog"
                              onClick={() => openEditModal(order)}
                              className="w-9 h-9 flex items-center justify-center rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                            >
                              <Edit3 size={16} />
                            </button>

                            <button
                              title="Obriši nalog"
                              onClick={() => deleteOrder(order.id)}
                              className="w-9 h-9 flex items-center justify-center rounded-md bg-red-50 text-red-700 hover:bg-red-100"
                            >
                              <X size={16} />
                            </button>

                            <button
                              title="Recept"
                              onClick={() => printRecept(order)}
                              className="w-9 h-9 flex items-center justify-center rounded-md bg-gray-800 text-white hover:brightness-90"
                            >
                              <Printer size={14} />
                            </button>
                          </div>

                          <div className="text-xs text-gray-500">Broj: #{order.id.slice(-8).toUpperCase()}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* MODALS (new/edit, recept, templates) */}
      {(showModal === 'new' || showModal === 'edit') && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 z-50" onClick={() => setShowModal('')}>
          <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className={`p-6 ${showModal === 'new' ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white' : 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white'}`}>
              <h3 className="text-2xl font-bold">{showModal === 'new' ? 'Novi nalog na servis' : 'Izmeni nalog'}</h3>
            </div>
            <form onSubmit={createOrUpdateOrder} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Ime i prezime *"
                  value={newOrder.ime}
                  onChange={(e) => setNewOrder({ ...newOrder, ime: e.target.value })}
                  className="p-3 border border-gray-200 rounded-lg w-full"
                  required
                />
                <input
                  type="tel"
                  placeholder="Broj telefona (381...)*"
                  value={newOrder.broj}
                  onChange={(e) => setNewOrder({ ...newOrder, broj: e.target.value })}
                  className="p-3 border border-gray-200 rounded-lg w-full"
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Marka (Samsung, iPhone...)*"
                  value={newOrder.brand}
                  onChange={(e) => setNewOrder({ ...newOrder, brand: e.target.value })}
                  className="p-3 border border-gray-200 rounded-lg w-full"
                  required
                />
                <input
                  type="text"
                  placeholder="Model *"
                  value={newOrder.model}
                  onChange={(e) => setNewOrder({ ...newOrder, model: e.target.value })}
                  className="p-3 border border-gray-200 rounded-lg w-full"
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="IMEI (15 cifara)"
                  value={newOrder.imei}
                  onChange={(e) => setNewOrder({ ...newOrder, imei: e.target.value })}
                  className="p-3 border border-gray-200 rounded-lg w-full"
                  maxLength={15}
                />
                <input
                  type="date"
                  value={newOrder.rok}
                  onChange={(e) => setNewOrder({ ...newOrder, rok: e.target.value })}
                  className="p-3 border border-gray-200 rounded-lg w-full"
                />
              </div>

              <textarea
                placeholder="Opis problema *"
                value={newOrder.opis}
                onChange={(e) => setNewOrder({ ...newOrder, opis: e.target.value })}
                rows={4}
                className="w-full p-3 border border-gray-200 rounded-lg"
                required
              />

              <div className="flex gap-3">
                <button
                  type="submit"
                  className="flex-1 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white py-3 rounded-lg font-medium"
                >
                  {showModal === 'new' ? 'Kreiraj + WhatsApp' : 'Sačuvaj izmene'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowModal(''); setSelectedOrder(null); }}
                  className="px-4 py-3 border rounded-lg"
                >
                  Otkaži
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showModal === 'recept' && selectedOrder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 z-50" onClick={() => setShowModal('')}>
          <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-4">
              <h3 className="text-2xl font-bold text-gray-900 mb-1">Recept / Potvrda</h3>
              <div className="inline-block px-4 py-1 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-full font-semibold text-sm">
                #{selectedOrder.id.slice(-8).toUpperCase()}
              </div>
            </div>
            <div className="space-y-3 text-sm">
              <div><strong>Korisnik:</strong> {selectedOrder.customers.ime}</div>
              <div><strong>Telefon:</strong> {selectedOrder.devices.brand} {selectedOrder.devices.model}</div>
              {selectedOrder.devices.imei && <div><strong>IMEI:</strong> {selectedOrder.devices.imei}</div>}
              <div><strong>Problem:</strong> {selectedOrder.opis_problema}</div>
              <div><strong>Status:</strong> <span className={`px-2 py-1 rounded-full font-bold ${
                selectedOrder.status === 'zavrsen' ? 'bg-green-100 text-green-800' : selectedOrder.status === 'neuspeh' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
              }`}>{selectedOrder.status.toUpperCase()}</span></div>
              <div className="text-xs text-gray-500 mt-4 border-t pt-3">
                Datum izdavanja: {new Date().toLocaleString('sr-RS')} | {companyName}
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => printRecept(selectedOrder)}
                className="flex-1 bg-gradient-to-r from-gray-800 to-gray-900 text-white py-2 rounded-lg"
              >
                Ispiši
              </button>
              <button
                onClick={() => setShowModal('')}
                className="flex-1 border rounded-lg py-2"
              >
                Zatvori
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal === 'templates' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 z-50" onClick={() => setShowModal('')}>
          <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-gray-700 to-gray-900 text-white p-4 rounded-t-3xl">
              <h3 className="text-lg font-bold">Uredi WhatsApp poruke + Preview</h3>
              <p className="text-xs opacity-80 mt-1">
                Koristi zamenske oznake:&nbsp;
                {'{{ime}}'}, {'{{brand}}'}, {'{{model}}'}, {'{{imei}}'}, {'{{rok}}'}, {'{{opis}}'}, {'{{status}}'}, {'{{order_id}}'}, {'{{company}}'}
              </p>
            </div>

            <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <div className="mb-2 font-semibold">Naziv firme (biće ubačen umesto {'{{company}}'})</div>
                <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="w-full p-2 border rounded mb-3" />

                <div className="mb-2 font-semibold">Sample preview context (možeš promeniti)</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                  <input value={previewCtx.ime} onChange={(e) => setPreviewCtx(prev => ({ ...prev, ime: e.target.value }))} className="p-2 border rounded" />
                  <input value={previewCtx.brand} onChange={(e) => setPreviewCtx(prev => ({ ...prev, brand: e.target.value }))} className="p-2 border rounded" />
                  <input value={previewCtx.model} onChange={(e) => setPreviewCtx(prev => ({ ...prev, model: e.target.value }))} className="p-2 border rounded" />
                  <input value={previewCtx.imei} onChange={(e) => setPreviewCtx(prev => ({ ...prev, imei: e.target.value }))} className="p-2 border rounded" />
                  <input value={previewCtx.rok} onChange={(e) => setPreviewCtx(prev => ({ ...prev, rok: e.target.value }))} className="p-2 border rounded" />
                  <input value={previewCtx.order_id} onChange={(e) => setPreviewCtx(prev => ({ ...prev, order_id: e.target.value }))} className="p-2 border rounded" />
                </div>

                <div className="mb-2 font-semibold">primljen</div>
                <textarea className="w-full p-2 border rounded mb-2 h-28" value={templates.primljen} onChange={(e) => setTemplates(prev => ({ ...prev, primljen: e.target.value }))} />
                <div className="p-2 bg-gray-50 border rounded text-sm whitespace-pre-wrap">{previewFor('primljen')}</div>

                <div className="mt-4 mb-2 font-semibold">neuspeh</div>
                <textarea className="w-full p-2 border rounded mb-2 h-20" value={templates.neuspeh} onChange={(e) => setTemplates(prev => ({ ...prev, neuspeh: e.target.value }))} />
                <div className="p-2 bg-gray-50 border rounded text-sm whitespace-pre-wrap">{previewFor('neuspeh')}</div>

                <div className="mt-4 mb-2 font-semibold">zavrsen</div>
                <textarea className="w-full p-2 border rounded mb-2 h-20" value={templates.zavrsen} onChange={(e) => setTemplates(prev => ({ ...prev, zavrsen: e.target.value }))} />
                <div className="p-2 bg-gray-50 border rounded text-sm whitespace-pre-wrap">{previewFor('zavrsen')}</div>
              </div>

              <div>
                <div className="mb-2 font-semibold">Kratka pomoć</div>
                <div className="text-sm text-gray-600 space-y-2">
                  <div>- U preview kontekstu promeni vrednosti da vidiš kako poruka izgleda.</div>
                  <div>- Klikni "Sačuvaj" da upišeš poruke i naziv firme u bazu (preporučeno: tabela wa_templates mora postojati).</div>
                  <div>- Ako želiš dodatne placeholders, reci pa dodam i u replacePlaceholders.</div>
                </div>

                <div className="mt-6">
                  <button onClick={() => saveTemplates(templates)} className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 text-white py-2 rounded-lg mb-2">Sačuvaj</button>
                  <button onClick={() => { setShowModal(''); fetchTemplates(); }} className="w-full border py-2 rounded-lg">Zatvori</button>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}