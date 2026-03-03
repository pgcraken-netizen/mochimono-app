import { useState, useEffect, useRef, useCallback } from "react";
import { APIProvider, Map, AdvancedMarker } from "@vis.gl/react-google-maps";

/* ══════════════════════════════════════════
    HELPERS (EXIF / GPS / COMPRESS)
══════════════════════════════════════════ */
function readExifGps(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const buf = e.target.result;
        const view = new DataView(buf);
        if (view.getUint16(0) !== 0xFFD8) { resolve(null); return; }
        let offset = 2;
        while (offset < buf.byteLength - 2) {
          const marker = view.getUint16(offset);
          if (marker === 0xFFE1) {
            const exifOffset = offset + 4;
            const hdr = String.fromCharCode(view.getUint8(exifOffset), view.getUint8(exifOffset+1), view.getUint8(exifOffset+2), view.getUint8(exifOffset+3));
            if (hdr !== 'Exif') { resolve(null); return; }
            const tiffStart = exifOffset + 6;
            const le = view.getUint16(tiffStart) === 0x4949;
            const r16 = o => view.getUint16(tiffStart + o, le);
            const r32 = o => view.getUint32(tiffStart + o, le);
            const ifd0 = r32(4);
            const entries = r16(ifd0);
            let gpsOff = null;
            for (let i = 0; i < entries; i++) {
              const eo = ifd0 + 2 + i * 12;
              if (r16(eo) === 0x8825) { gpsOff = r32(eo + 8); break; }
            }
            if (gpsOff === null) { resolve(null); return; }
            const gpsN = r16(gpsOff);
            const g = {};
            const getRat = (byteOff, n) => {
              const vals = [];
              for (let j = 0; j < n; j++) {
                const num = r32(byteOff + j * 8);
                const den = r32(byteOff + j * 8 + 4);
                vals.push(den === 0 ? 0 : num / den);
              }
              return vals;
            };
            for (let i = 0; i < gpsN; i++) {
              const eo = gpsOff + 2 + i * 12;
              const tag = r16(eo), type = r16(eo+2), cnt = r32(eo+4), vo = eo+8;
              if (tag === 1) g.latRef = String.fromCharCode(view.getUint8(tiffStart + vo));
              if (tag === 3) g.lngRef = String.fromCharCode(view.getUint8(tiffStart + vo));
              if (tag === 2 && type === 5) {
                const off = cnt <= 1 ? vo : r32(vo);
                const [d,m,s] = getRat(tiffStart + off, 3);
                g.lat = d + m/60 + s/3600;
              }
              if (tag === 4 && type === 5) {
                const off = cnt <= 1 ? vo : r32(vo);
                const [d,m,s] = getRat(tiffStart + off, 3);
                g.lng = d + m/60 + s/3600;
              }
            }
            if (g.lat != null && g.lng != null) {
              const lat = g.latRef === 'S' ? -g.lat : g.lat;
              const lng = g.lngRef === 'W' ? -g.lng : g.lng;
              resolve({ lat, lng, source: 'exif' }); return;
            }
            resolve(null); return;
          }
          const segLen = view.getUint16(offset + 2);
          offset += 2 + segLen;
        }
      } catch { }
      resolve(null);
    };
    reader.readAsArrayBuffer(file);
  });
}

function getDeviceGps() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null), { timeout: 8000 }
    );
  });
}

async function compressImage(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.readAsDataURL(file);
  });
}

const distKm = (a, b) => {
  if (!a || !b) return null;
  const R=6371, dLat=(b.lat-a.lat)*Math.PI/180, dLng=(b.lng-a.lng)*Math.PI/180;
  const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
};

/* ══════════════════════════════════════════
    STYLES
══════════════════════════════════════════ */
const S = {
  app: { display:'flex', flexDirection:'column', height:'100vh', maxWidth:480, margin:'0 auto', background:'#f4f6fa', position:'relative', overflow:'hidden' },
  header: { height:58, background:'#fff', borderBottom:'1.5px solid #dde3ed', display:'flex', alignItems:'center', padding:'0 18px', zIndex:50 },
  logo: { fontSize:20, fontWeight:900 },
  content: { flex:1, position:'relative', overflow:'hidden' },
  nav: { height:66, background:'#fff', borderTop:'1.5px solid #dde3ed', display:'flex', zIndex:50 },
  navItem: (active) => ({ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color: active ? '#2563eb' : '#9aa3b2', cursor:'pointer' }),
  fab: { position:'absolute', bottom:80, right:18, padding:'12px 20px', borderRadius:26, background:'#2563eb', color:'#fff', border:'none', fontWeight:700, boxShadow:'0 4px 12px rgba(0,0,0,0.2)', zIndex:40 },
  mapContainer: { height: '100%', width: '100%' },
  mapCard: { position:'absolute', bottom:10, left:10, right:10, background:'#fff', padding:12, borderRadius:12, boxShadow:'0 4px 12px rgba(0,0,0,0.15)', zIndex:100, display:'flex', gap:12, alignItems:'center' },
  mapCardThumb: { width:50, height:50, borderRadius:8, background:'#f0f2f5', display:'flex', alignItems:'center', justifyContent:'center', fontSize:24, overflow:'hidden' },
  myDot: { width:14, height:14, background:'#2563eb', border:'2px solid #fff', borderRadius:'50%' },
  itemRow: { display:'flex', gap:12, padding:15, background:'#fff', borderBottom:'1px solid #eee', cursor:'pointer' },
  pill: (active) => ({ padding:'2px 8px', borderRadius:10, fontSize:11, background: active ? '#eff4ff' : '#f0f0f0', color: active ? '#2563eb' : '#666' }),
  input: { width:'100%', padding:12, border:'1px solid #ddd', borderRadius:8, marginBottom:10 },
  textarea: { width:'100%', padding:12, border:'1px solid #ddd', borderRadius:8, height:80 },
  btn: (primary) => ({ padding:12, background: primary ? '#2563eb' : '#fff', color: primary ? '#fff' : '#333', border: primary ? 'none' : '1px solid #ddd', borderRadius:8, fontWeight:700, cursor:'pointer' }),
  detailHero: { height:220, background:'#eee', position:'relative', display:'flex', alignItems:'center', justifyContent:'center', fontSize:60 },
  detailBack: { position:'absolute', top:15, left:15, width:35, height:35, background:'#fff', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:'0 2px 5px rgba(0,0,0,0.1)' }
};

const SEED = [
  { id:'d1', name:'テスト用アイテム', contact:'090-0000-0000', memo:'テスト', emoji:'📦', status:'waiting', lat:35.6895, lng:139.6917, ts:Date.now() },
];
const EMOJIS = ['📦','🔧','🎒','📱','🪑'];

/* ══════════════════════════════════════════
    COMPONENTS
══════════════════════════════════════════ */

function MapScreen({ items, gps, onDetail }) {
  const [cardId, setCardId] = useState(null);
  const cardItem = items.find(i => i.id === cardId);

  return (
    <div style={S.mapContainer}>
      <Map
        defaultCenter={gps || { lat: 35.6895, lng: 139.6917 }}
        defaultZoom={14}
        mapId={'DEMO_MAP_ID'}
        onClick={() => setCardId(null)}
      >
        {items.filter(i => i.status === 'waiting').map(item => (
          <AdvancedMarker key={item.id} position={{ lat: item.lat, lng: item.lng }} onClick={(e) => { setCardId(item.id); }}>
            <div style={{ fontSize: "32px", transform: 'translate(-50%, -100%)' }}>{item.emoji}</div>
          </AdvancedMarker>
        ))}
        {gps && <AdvancedMarker position={gps}><div style={S.myDot}/></AdvancedMarker>}
      </Map>

      {cardItem && (
        <div style={S.mapCard} onClick={() => onDetail(cardItem.id)}>
          <div style={S.mapCardThumb}>
            {cardItem.photo ? <img src={cardItem.photo} style={{width:'100%',height:'100%',objectFit:'cover'}} /> : cardItem.emoji}
          </div>
          <div style={{flex:1}}>
            <div style={{fontWeight:800}}>{cardItem.name}</div>
            <div style={{fontSize:12, color:'#666'}}>{cardItem.memo || '詳細を見る'}</div>
          </div>
          <div style={{fontSize:18, color:'#ccc'}}>›</div>
        </div>
      )}
    </div>
  );
}

function ListScreen({ items, gps, onDetail }) {
  const waiting = items.filter(i => i.status === 'waiting');
  return (
    <div style={{overflowY:'auto', height:'100%'}}>
      {waiting.length === 0 ? <div style={{padding:40, textAlign:'center'}}>空っぽです</div> : 
        waiting.map(item => (
          <div key={item.id} style={S.itemRow} onClick={() => onDetail(item.id)}>
            <div style={{fontSize:30, width:50}}>{item.emoji}</div>
            <div style={{flex:1}}>
              <div style={{fontWeight:700}}>{item.name}</div>
              <div style={{fontSize:12, color:'#666'}}>📍 距離: {gps ? distKm(gps, item).toFixed(1) : '--'} km</div>
            </div>
          </div>
        ))
      }
    </div>
  );
}

function RegisterScreen({ onBack, onSave }) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [memo, setMemo] = useState('');
  const [photo, setPhoto] = useState(null);
  const [loc, setLoc] = useState(null);

  useEffect(() => { getDeviceGps().then(setLoc); }, []);

  const handleFile = async (e) => {
    const file = e.target.files[0]; if(!file) return;
    const exif = await readExifGps(file);
    if(exif) setLoc(exif);
    const img = await compressImage(file);
    setPhoto(img);
  };

  return (
    <div style={{background:'#fff', height:'100%', overflowY:'auto', padding:20}}>
      <div style={{display:'flex', gap:10, marginBottom:20}}>
        <button onClick={onBack} style={S.btn(false)}>←</button>
        <h2 style={{margin:0}}>新規登録</h2>
      </div>
      <div style={{...S.detailHero, borderRadius:12, marginBottom:20}} onClick={() => document.getElementById('f').click()}>
        {photo ? <img src={photo} style={{width:'100%',height:'100%',objectFit:'cover', borderRadius:12}} /> : '📷 写真を撮る'}
        <input id="f" type="file" hidden onChange={handleFile} accept="image/*" capture="environment" />
      </div>
      <input style={S.input} placeholder="物の名前" value={name} onChange={e => setName(e.target.value)} />
      <input style={S.input} placeholder="連絡先" value={contact} onChange={e => setContact(e.target.value)} />
      <textarea style={S.textarea} placeholder="メモ" value={memo} onChange={e => setMemo(e.target.value)} />
      <div style={{margin:'15px 0', fontSize:12, color: loc ? 'green' : 'orange'}}>
        {loc ? `📍 位置情報取得済み (${loc.lat.toFixed(4)})` : '⌛ 位置情報を取得中...'}
      </div>
      <button style={{...S.btn(true), width:'100%'}} onClick={() => onSave({
        id: Date.now(), name, contact, memo, photo, 
        emoji: EMOJIS[Math.floor(Math.random()*EMOJIS.length)],
        status: 'waiting', lat: loc?.lat || 35.68, lng: loc?.lng || 139.69, ts: Date.now()
      })}>登録を完了する</button>
    </div>
  );
}

function DetailScreen({ item, onBack, onDone }) {
  if(!item) return null;
  return (
    <div style={{background:'#fff', height:'100%', overflowY:'auto'}}>
      <div style={S.detailHero}>
        <div style={S.detailBack} onClick={onBack}>←</div>
        {item.photo ? <img src={item.photo} style={{width:'100%',height:'100%',objectFit:'cover'}} /> : item.emoji}
      </div>
      <div style={{padding:20}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <h2 style={{margin:0}}>{item.name}</h2>
          <div style={S.pill(item.status === 'waiting')}>{item.status}</div>
        </div>
        <p style={{color:'#666'}}>{item.memo}</p>
        <div style={{background:'#f0f2f5', padding:15, borderRadius:12, marginBottom:20}}>
          <div style={{fontSize:12, color:'#888'}}>連絡先</div>
          <div style={{fontWeight:700}}>{item.contact}</div>
        </div>
        <button style={{...S.btn(true), width:'100%', background:'#16a34a'}} onClick={() => onDone(item.id)}>引き取り完了にする</button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
    MAIN APP
══════════════════════════════════════════ */
export default function App() {
  console.log("API Key Check:", import.meta.env.VITE_GOOGLE_MAPS_API_KEY);
  const [items, setItems] = useState(SEED);
  const [tab, setTab] = useState('map');
  const [detailId, setDetailId] = useState(null);
  const [showRegister, setShowRegister] = useState(false);
  const [gps, setGps] = useState(null);

  useEffect(() => { getDeviceGps().then(setGps); }, []);

  const handleRegister = (newItem) => {
    setItems(prev => [newItem, ...prev]);
    setShowRegister(false);
  };

  const handleDone = (id) => {
    setItems(prev => prev.map(i => i.id === id ? {...i, status:'done'} : i));
    setDetailId(null);
  };

  return (
    <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}>
      <div style={S.app}>
        <div style={S.header}><div style={S.logo}>もちもの帳</div></div>
        <div style={S.content}>
          {detailId ? (
            <DetailScreen item={items.find(i => i.id === detailId)} onBack={() => setDetailId(null)} onDone={handleDone} />
          ) : showRegister ? (
            <RegisterScreen onBack={() => setShowRegister(false)} onSave={handleRegister} />
          ) : (
            <>
              {tab === 'map' ? <MapScreen items={items} gps={gps} onDetail={setDetailId} /> : <ListScreen items={items} gps={gps} onDetail={setDetailId} />}
              <button style={S.fab} onClick={() => setShowRegister(true)}>＋ 登録する</button>
            </>
          )}
        </div>
        <div style={S.nav}>
          <div style={S.navItem(tab === 'map')} onClick={() => {setTab('map'); setDetailId(null);}}>🗺 マップ</div>
          <div style={S.navItem(tab === 'list')} onClick={() => {setTab('list'); setDetailId(null);}}>📋 リスト</div>
        </div>
      </div>
    </APIProvider>
  );
}