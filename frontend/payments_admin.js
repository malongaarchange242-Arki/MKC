/* payments_admin.js
   Admin UI to list paiements and view/download proofs from Supabase Storage.
*/
(async function(){
  function id(v){ return document.getElementById(v); }
  const supabaseUrl = document.querySelector('meta[name="supabase-url"]').content || '';
  const supabaseKey = document.querySelector('meta[name="supabase-key"]').content || '';
  if(!supabaseUrl || !supabaseKey){ document.getElementById('list-area').textContent = 'Supabase non configuré (meta tags manquantes).'; return; }
  const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

  const area = document.getElementById('list-area');

  async function load(){
    area.textContent = 'Chargement…';
    // try to fetch paiements and related profile via explicit join if relation exists
    const { data, error } = await supabase.from('paiements').select('*, profiles: user_id(*)').order('created_at',{ascending:false}).limit(200);
    if(error){ console.error(error); area.textContent = 'Erreur lors de la récupération des paiements.'; return; }

    if(!data || data.length===0){ area.textContent = 'Aucun paiement trouvé.'; return; }

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const lbl = (k, def) => (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t(k) : def;
    thead.innerHTML = `<tr><th>${lbl('client','Client')}</th><th>${lbl('request_id','RequestId')}</th><th>${lbl('date','Date')}</th><th>${lbl('status','Statut')}</th><th>${lbl('actions','Actions')}</th></tr>`;
    table.appendChild(thead);
    const tbody = document.createElement('tbody');

    for(const p of data){
      const tr = document.createElement('tr');
      const profile = p.profiles && p.profiles[0];
      const clientName = profile ? (profile.full_name || profile.name || profile.email || profile.id) : (p.user_id||'—');
      const date = p.created_at ? new Date(p.created_at).toLocaleString('fr-FR') : '—';
      tr.innerHTML = `<td>${clientName}</td><td>${p.request_id}</td><td>${date}</td><td id="status-${p.id}">${(window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t(p.status||'pending') : (p.status||'pending')}</td>`;
      const actTd = document.createElement('td'); actTd.className='actions';
      const viewBtn = document.createElement('button'); viewBtn.textContent = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t('view_proof') : 'View Proof';
      viewBtn.addEventListener('click', ()=>openProof(p.storage_path));
      const okBtn = document.createElement('button'); okBtn.textContent = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t('validate') : 'Validate'; okBtn.addEventListener('click', ()=>updateStatus(p.id,'validated'));
      const rejBtn = document.createElement('button'); rejBtn.textContent = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t('reject') : 'Reject'; rejBtn.addEventListener('click', ()=>updateStatus(p.id,'rejected'));
      actTd.appendChild(viewBtn); actTd.appendChild(okBtn); actTd.appendChild(rejBtn);
      tr.appendChild(actTd); tbody.appendChild(tr);
    }
    table.appendChild(tbody); area.innerHTML=''; area.appendChild(table);
  }

  async function openProof(path){
    try{
      const { data, error } = await supabase.storage.from('payment_proofs').createSignedUrl(path, 60);
      if(error){ console.error(error); alert('Impossible de créer l’URL signée. Vérifiez les droits.'); return; }
      window.open(data.signedUrl, '_blank');
    }catch(err){ console.error(err); alert('Erreur lors de la récupération du fichier.'); }
  }

  async function updateStatus(id, newStatus){
    try{
      const { error } = await supabase.from('paiements').update({status:newStatus}).eq('id', id);
      if(error){ console.error(error); alert('Échec de la mise à jour.'); return; }
      const el = document.getElementById(`status-${id}`); if(el) el.textContent = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t(newStatus) : newStatus;
    }catch(err){ console.error(err); alert('Erreur inattendue.'); }
  }

  load();
  // refresh every 60s
  setInterval(load, 60000);

})();
