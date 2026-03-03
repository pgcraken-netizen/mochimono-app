/* ══════════════════════════════════════════
    MAIN APP (修正版)
══════════════════════════════════════════ */
export default function App() {
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

  // 表示する画面を判定
  let page = null;
  if (showRegister) {
    page = <RegisterScreen onBack={() => setShowRegister(false)} onSave={handleRegister} />;
  } else if (detailId) {
    page = <DetailScreen item={items.find(i => i.id === detailId)} onBack={() => setDetailId(null)} onDone={handleDone} />;
  } else {
    page = tab === 'map' ? 
      <MapScreen items={items} gps={gps} onDetail={setDetailId} /> : 
      <ListScreen items={items} gps={gps} onDetail={setDetailId} />;
  }

  return (
    <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}>
      {/* maxWidth:480 を外して画面いっぱいに広げます。
         スマホでの使い勝手を考え、中央寄せ(margin:0 auto)は維持します。
      */}
      <div style={{ ...S.app, maxWidth: 'none', width: '100vw' }}>
        <header style={S.header}>
          <div style={S.logo}>もちもの帳</div>
        </header>

        <div style={S.content}>
          {page}
          
          {/* マップ表示中で、かつ詳細画面や登録画面が開いていない時だけボタンを出す */}
          {!showRegister && !detailId && tab === 'map' && (
            <button 
              style={S.fab} 
              onClick={() => setShowRegister(true)}
            >
              ＋ 登録する
            </button>
          )}
        </div>

        <nav style={S.nav}>
          <div style={S.navItem(tab === 'map')} onClick={() => {setTab('map'); setDetailId(null); setShowRegister(false);}}>
            <span style={{fontSize:24}}>🗺️</span>
            <span style={{fontSize:10}}>マップ</span>
          </div>
          <div style={S.navItem(tab === 'list')} onClick={() => {setTab('list'); setDetailId(null); setShowRegister(false);}}>
            <span style={{fontSize:24}}>📋</span>
            <span style={{fontSize:10}}>リスト</span>
          </div>
        </nav>
      </div>
    </APIProvider>
  );
}