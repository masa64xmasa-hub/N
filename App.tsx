import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, collection, doc, setDoc, addDoc, updateDoc, onSnapshot, 
  serverTimestamp, arrayUnion, arrayRemove
} from 'firebase/firestore';
import { 
  Hash, Lock, MessageSquare, Search, Bell, Pin, User, Send, Smile, Paperclip, 
  Plus, Settings, Sparkles, Image, X, Reply, Sun, Moon, Users, CheckCircle2, Clock, MinusCircle, Circle
} from 'lucide-react';

// ==========================================
// 1. Firebase 初期化設定
// ==========================================
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : {
      // 開発フォールバック用ダミー設定
      apiKey: "demo-api-key",
      authDomain: "demo-app.firebaseapp.com",
      projectId: "demo-app",
      storageBucket: "demo-app.appspot.com",
      messagingSenderId: "123456789",
      appId: "1:123456789:web:123456789"
    };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'company-community-chat';

// コレクションパス定義 (ルール準拠)
const getPublicColl = (collName) => collection(db, 'artifacts', appId, 'public', 'data', collName);
const getPublicDoc = (collName, docId) => doc(db, 'artifacts', appId, 'public', 'data', collName, docId);

const EMOJI_LIST = ['👍', '❤️', '🔥', '🎉', '😊', '🚀', '👀', '✅', '💡', '🙏'];

export default function App() {
  // Theme & Auth state
  const [darkMode, setDarkMode] = useState(true);
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState({
    name: 'ゲスト社員',
    role: 'メンバー',
    status: 'active',
    statusText: '作業中 💻',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150'
  });

  // Data State
  const [channels, setChannels] = useState([]);
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);

  // Active view state
  const [activeTab, setActiveTab] = useState('general'); // channelId or userId
  const [isDirectMessage, setIsDirectMessage] = useState(false);

  // UI state
  const [inputText, setInputText] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [activeThreadMessage, setActiveThreadMessage] = useState(null);
  const [threadInputText, setThreadInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelDesc, setNewChannelDesc] = useState('');
  const [newChannelType, setNewChannelType] = useState('public');
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [showMemberSidebar, setShowMemberSidebar] = useState(true);

  const messagesEndRef = useRef(null);

  // ==========================================
  // 2. 認証処理 (RULE 3)
  // ==========================================
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth initialization error:", err);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (authUser) => {
      setUser(authUser);
    });
    return () => unsubscribe();
  }, []);

  // ==========================================
  // 3. オンラインステータス同期 & メンバーPresence (BroadcastChannel + Firestore)
  // ==========================================
  useEffect(() => {
    if (!user) return;

    // 初期ローカルストレージ参照（名前や役職の復元）
    const savedName = localStorage.getItem(`user_name_${user.uid}`);
    const savedRole = localStorage.getItem(`user_role_${user.uid}`);
    const savedAvatar = localStorage.getItem(`user_avatar_${user.uid}`);
    
    const initialProfile = {
      id: user.uid,
      name: savedName || `社員_${user.uid.slice(0, 4)}`,
      role: savedRole || 'コミュニティメンバー',
      status: 'active',
      statusText: 'オンライン 🟢',
      avatar: savedAvatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.uid}`,
      lastActive: new Date().toISOString()
    };
    
    setUserProfile(initialProfile);

    // ユーザー情報のFirestore登録・更新
    const userDocRef = getPublicDoc('users', user.uid);
    setDoc(userDocRef, initialProfile, { merge: true }).catch(console.error);

    // 離脱・タブ閉じ時にステータスをオフライン化
    const handleBeforeUnload = () => {
      setDoc(userDocRef, { status: 'offline' }, { merge: true });
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    // 複数タブ間の同期用 BroadcastChannel
    const bc = new BroadcastChannel('app_presence_channel');
    bc.postMessage({ type: 'USER_JOINED', uid: user.uid });

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      setDoc(userDocRef, { status: 'offline' }, { merge: true }).catch(console.error);
      bc.close();
    };
  }, [user]);

  // ==========================================
  // 4. Firestore リアルタイムリスナー (RULE 1, 2)
  // ==========================================
  useEffect(() => {
    if (!user) return;

    // A. チャンネル取得
    const channelsUnsub = onSnapshot(
      getPublicColl('channels'),
      (snapshot) => {
        let chList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // デフォルトチャンネルが無い場合は自動作成
        if (chList.length === 0) {
          const defaultCh = { id: 'general', name: 'general', type: 'public', description: '全社共通の雑談・連絡用チャンネル' };
          setDoc(getPublicDoc('channels', 'general'), defaultCh);
          chList = [defaultCh];
        }
        setChannels(chList);
      },
      (err) => console.error("Channels listener error:", err)
    );

    // B. メンバー取得
    const membersUnsub = onSnapshot(
      getPublicColl('users'),
      (snapshot) => {
        const memberList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setMembers(memberList);
      },
      (err) => console.error("Members listener error:", err)
    );

    // C. メッセージリアルタイム取得 (RULE 2: JSメモリ内でソート)
    const messagesUnsub = onSnapshot(
      getPublicColl('messages'),
      (snapshot) => {
        const msgList = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            // サーバータイムスタンプのフォールバック
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date()
          };
        });

        // 日時でソート
        msgList.sort((a, b) => a.createdAt - b.createdAt);
        setMessages(msgList);
      },
      (err) => console.error("Messages listener error:", err)
    );

    return () => {
      channelsUnsub();
      membersUnsub();
      messagesUnsub();
    };
  }, [user]);

  // メッセージのスクロール追従
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTab]);

  // ==========================================
  // 5. アクションハンドラー
  // ==========================================

  // メッセージ送信
  const handleSendMessage = async (e) => {
    e?.preventDefault();
    if ((!inputText.trim() && attachedFiles.length === 0) || !user) return;

    const newMsg = {
      targetId: activeTab, // channelId または DMのuserId
      isDM: isDirectMessage,
      senderId: user.uid,
      senderName: userProfile.name,
      senderAvatar: userProfile.avatar,
      content: inputText,
      attachments: attachedFiles,
      reactions: [],
      pinned: false,
      replies: [],
      createdAt: serverTimestamp(),
      formattedTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setInputText('');
    setAttachedFiles([]);
    setShowEmojiPicker(false);

    try {
      await addDoc(getPublicColl('messages'), newMsg);
    } catch (err) {
      console.error("Failed to send message:", err);
    }
  };

  // スレッド返信送信
  const handleSendThreadReply = async (e) => {
    e?.preventDefault();
    if (!threadInputText.trim() || !activeThreadMessage || !user) return;

    const newReply = {
      id: `r_${Date.now()}`,
      senderId: user.uid,
      senderName: userProfile.name,
      senderAvatar: userProfile.avatar,
      content: threadInputText,
      formattedTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const msgRef = getPublicDoc('messages', activeThreadMessage.id);
    const updatedReplies = [...(activeThreadMessage.replies || []), newReply];

    setThreadInputText('');
    setActiveThreadMessage(prev => ({ ...prev, replies: updatedReplies }));

    try {
      await updateDoc(msgRef, { replies: arrayUnion(newReply) });
    } catch (err) {
      console.error("Failed to send reply:", err);
    }
  };

  // リアクション追加 / 解除
  const handleToggleReaction = async (msgId, emoji) => {
    if (!user) return;
    const msg = messages.find(m => m.id === msgId);
    if (!msg) return;

    let existingReactions = [...(msg.reactions || [])];
    const matchIndex = existingReactions.findIndex(r => r.emoji === emoji);

    if (matchIndex > -1) {
      const target = existingReactions[matchIndex];
      const hasUser = target.users.includes(user.uid);

      if (hasUser) {
        const updatedUsers = target.users.filter(u => u !== user.uid);
        if (updatedUsers.length === 0) {
          existingReactions.splice(matchIndex, 1);
        } else {
          existingReactions[matchIndex] = { ...target, count: target.count - 1, users: updatedUsers };
        }
      } else {
        existingReactions[matchIndex] = { ...target, count: target.count + 1, users: [...target.users, user.uid] };
      }
    } else {
      existingReactions.push({ emoji, count: 1, users: [user.uid] });
    }

    try {
      await updateDoc(getPublicDoc('messages', msgId), { reactions: existingReactions });
    } catch (err) {
      console.error("Failed to update reaction:", err);
    }
  };

  // ピン留め切替
  const handleTogglePin = async (msgId, currentPinned) => {
    try {
      await updateDoc(getPublicDoc('messages', msgId), { pinned: !currentPinned });
    } catch (err) {
      console.error("Failed to toggle pin:", err);
    }
  };

  // チャンネル新規作成
  const handleCreateChannel = async (e) => {
    e?.preventDefault();
    if (!newChannelName.trim() || !user) return;

    const channelId = newChannelName.toLowerCase().replace(/\s+/g, '-');
    const newCh = {
      name: channelId,
      description: newChannelDesc || '新しいプロジェクトチャンネル',
      type: newChannelType,
      createdBy: user.uid,
      createdAt: new Date().toISOString()
    };

    try {
      await setDoc(getPublicDoc('channels', channelId), newCh);
      setNewChannelName('');
      setNewChannelDesc('');
      setShowCreateChannelModal(false);
      setActiveTab(channelId);
      setIsDirectMessage(false);
    } catch (err) {
      console.error("Failed to create channel:", err);
    }
  };

  // プロフィール更新
  const handleSaveProfile = async () => {
    if (!user) return;
    
    localStorage.setItem(`user_name_${user.uid}`, userProfile.name);
    localStorage.setItem(`user_role_${user.uid}`, userProfile.role);
    localStorage.setItem(`user_avatar_${user.uid}`, userProfile.avatar);

    try {
      await setDoc(getPublicDoc('users', user.uid), userProfile, { merge: true });
      setShowProfileModal(false);
    } catch (err) {
      console.error("Failed to update profile:", err);
    }
  };

  // ダミーファイル添付
  const handleSimulateFileUpload = () => {
    const fakeFile = {
      name: `添付資料_v${Math.floor(Math.random() * 90 + 10)}.png`,
      type: 'image',
      url: `https://picsum.photos/seed/${Math.random()}/600/400`
    };
    setAttachedFiles(prev => [...prev, fakeFile]);
  };

  // 表示中メッセージのフィルタリング
  const filteredMessages = messages.filter(msg => {
    if (isDirectMessage) {
      return msg.isDM && ((msg.senderId === user?.uid && msg.targetId === activeTab) || (msg.senderId === activeTab && msg.targetId === user?.uid));
    } else {
      return !msg.isDM && msg.targetId === activeTab;
    }
  }).filter(msg => (showPinnedOnly ? msg.pinned : true));

  // ステータスバッジ
  const getStatusBadge = (status) => {
    switch (status) {
      case 'active':
        return <span className="w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-slate-900 inline-block" title="アクティブ" />;
      case 'away':
        return <span className="w-3 h-3 rounded-full bg-amber-500 ring-2 ring-slate-900 inline-block" title="離席中" />;
      case 'dnd':
        return <span className="w-3 h-3 rounded-full bg-rose-500 ring-2 ring-slate-900 inline-block" title="応答不可" />;
      default:
        return <span className="w-3 h-3 rounded-full bg-slate-500 ring-2 ring-slate-900 inline-block" title="オフライン" />;
    }
  };

  const currentChannel = !isDirectMessage ? channels.find(c => c.id === activeTab) : null;
  const currentDMUser = isDirectMessage ? members.find(m => m.id === activeTab) : null;

  return (
    <div className={`flex h-screen w-full font-sans antialiased select-none ${darkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-100 text-slate-800'}`}>
      
      {/* モバイルサイドバー用バックドロップ */}
      {showMobileSidebar && (
        <div 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setShowMobileSidebar(false)}
        />
      )}

      {/* ===== サイドバー ===== */}
      <aside className={`
        fixed md:relative z-50 h-full w-72 flex flex-col border-r transition-all duration-300 ease-in-out
        ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}
        ${showMobileSidebar ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        {/* 社名・ヘッダー */}
        <div className={`p-4 border-b flex items-center justify-between ${darkMode ? 'border-slate-800' : 'border-slate-200'}`}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold text-lg shadow-md shadow-indigo-500/20">
              C
            </div>
            <div>
              <h1 className="font-bold text-sm tracking-wide leading-none">CorpConnect</h1>
              <span className="text-[11px] text-emerald-400 font-medium mt-1 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> リアルタイム通信中
              </span>
            </div>
          </div>
          <button 
            onClick={() => setDarkMode(!darkMode)}
            className={`p-2 rounded-lg transition ${darkMode ? 'hover:bg-slate-800 text-amber-400' : 'hover:bg-slate-100 text-slate-600'}`}
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        {/* メッセージ検索ボタン */}
        <div className="p-3">
          <button 
            onClick={() => setShowSearchModal(true)}
            className={`w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg border transition ${
              darkMode 
                ? 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:bg-slate-800' 
                : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
            }`}
          >
            <Search size={14} />
            <span>全メッセージを検索...</span>
          </button>
        </div>

        {/* チャンネル & DM 一覧 */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-6">
          
          {/* チャンネルセクション */}
          <div>
            <div className="flex items-center justify-between px-2 mb-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              <span>チャンネル ({channels.length})</span>
              <button 
                onClick={() => setShowCreateChannelModal(true)} 
                className="hover:text-indigo-400 transition" 
                title="チャンネルを作成"
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="space-y-0.5">
              {channels.map((ch) => {
                const isActive = activeTab === ch.id && !isDirectMessage;
                return (
                  <button
                    key={ch.id}
                    onClick={() => { setActiveTab(ch.id); setIsDirectMessage(false); setShowMobileSidebar(false); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition font-medium ${
                      isActive 
                        ? 'bg-indigo-600 text-white font-semibold shadow-sm' 
                        : darkMode 
                          ? 'text-slate-300 hover:bg-slate-800/60' 
                          : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {ch.type === 'private' ? <Lock size={16} className="shrink-0" /> : <Hash size={16} className="shrink-0" />}
                    <span className="truncate">{ch.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ダイレクトメッセージ・オンラインメンバー */}
          <div>
            <div className="flex items-center justify-between px-2 mb-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              <span>オンラインメンバー ({members.length})</span>
            </div>
            <div className="space-y-0.5">
              {members.filter(m => m.id !== user?.uid).map((member) => {
                const isActive = activeTab === member.id && isDirectMessage;
                return (
                  <button
                    key={member.id}
                    onClick={() => { setActiveTab(member.id); setIsDirectMessage(true); setShowMobileSidebar(false); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition ${
                      isActive 
                        ? 'bg-indigo-600 text-white font-semibold shadow-sm' 
                        : darkMode 
                          ? 'text-slate-300 hover:bg-slate-800/60' 
                          : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <div className="relative shrink-0">
                      <img src={member.avatar} alt={member.name} className="w-6 h-6 rounded-full object-cover" />
                      <div className="absolute -bottom-0.5 -right-0.5">
                        {getStatusBadge(member.status)}
                      </div>
                    </div>
                    <span className="truncate">{member.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 自プロフフッター */}
        <div className={`p-3 border-t ${darkMode ? 'border-slate-800 bg-slate-900/50' : 'border-slate-200 bg-slate-50'}`}>
          <div className="flex items-center justify-between">
            <div 
              onClick={() => setShowProfileModal(true)}
              className="flex items-center gap-2.5 cursor-pointer p-1.5 rounded-lg hover:bg-slate-800/40 transition flex-1 min-w-0"
            >
              <div className="relative shrink-0">
                <img src={userProfile.avatar} alt={userProfile.name} className="w-9 h-9 rounded-full object-cover border border-indigo-500/30" />
                <div className="absolute -bottom-0.5 -right-0.5">
                  {getStatusBadge(userProfile.status)}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate leading-tight">{userProfile.name}</p>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">{userProfile.statusText}</p>
              </div>
            </div>
            <button 
              onClick={() => setShowProfileModal(true)}
              className={`p-2 rounded-lg transition ${darkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-200 text-slate-600'}`}
              title="設定"
            >
              <Settings size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* ===== メインコンテンツ ===== */}
      <main className="flex-1 flex flex-col h-full min-w-0 relative">
        
        {/* チャットヘッダー */}
        <header className={`h-16 px-4 md:px-6 border-b flex items-center justify-between shrink-0 z-10 ${darkMode ? 'bg-slate-900/80 border-slate-800 backdrop-blur' : 'bg-white/80 border-slate-200 backdrop-blur'}`}>
          <div className="flex items-center gap-3 min-w-0">
            <button 
              onClick={() => setShowMobileSidebar(true)}
              className={`md:hidden p-2 rounded-lg ${darkMode ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}
            >
              <Hash size={20} />
            </button>

            {!isDirectMessage && currentChannel && (
              <>
                <div className="flex items-center gap-1.5 font-bold text-lg">
                  {currentChannel.type === 'private' ? <Lock size={18} className="text-slate-400" /> : <Hash size={18} className="text-slate-400" />}
                  <span className="truncate">{currentChannel.name}</span>
                </div>
                <div className="hidden sm:block text-slate-400 text-xs border-l pl-3 ml-1 border-slate-700/50 truncate">
                  {currentChannel.description}
                </div>
              </>
            )}

            {isDirectMessage && currentDMUser && (
              <div className="flex items-center gap-2.5">
                <div className="relative">
                  <img src={currentDMUser.avatar} alt={currentDMUser.name} className="w-7 h-7 rounded-full object-cover" />
                  <div className="absolute -bottom-0.5 -right-0.5">
                    {getStatusBadge(currentDMUser.status)}
                  </div>
                </div>
                <div>
                  <h2 className="font-bold text-sm leading-none">{currentDMUser.name}</h2>
                  <span className="text-[11px] text-slate-400">{currentDMUser.role}</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button 
              onClick={() => setShowPinnedOnly(!showPinnedOnly)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition ${
                showPinnedOnly 
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' 
                  : darkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-600'
              }`}
            >
              <Pin size={15} />
              <span className="hidden sm:inline">ピン留め</span>
            </button>

            <button 
              onClick={() => setShowMemberSidebar(!showMemberSidebar)}
              className={`p-2 rounded-lg transition ${
                showMemberSidebar 
                  ? darkMode ? 'bg-slate-800 text-indigo-400' : 'bg-slate-100 text-indigo-600'
                  : darkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-600'
              }`}
            >
              <Users size={18} />
            </button>
          </div>
        </header>

        {/* チャットメッセージ ＆ 右サイドバー */}
        <div className="flex-1 flex overflow-hidden relative">
          
          {/* メッセージ表示リスト */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
            
            {showPinnedOnly && (
              <div className={`p-3 rounded-lg flex items-center justify-between text-xs border ${darkMode ? 'bg-amber-500/10 border-amber-500/20 text-amber-300' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                <div className="flex items-center gap-2">
                  <Pin size={14} />
                  <span>現在、ピン留めされたメッセージのみを表示しています</span>
                </div>
                <button onClick={() => setShowPinnedOnly(false)} className="underline font-semibold">
                  すべて表示
                </button>
              </div>
            )}

            {filteredMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2">
                <MessageSquare size={40} className="opacity-30 stroke-1" />
                <p className="text-sm">メッセージはまだありません。</p>
                <p className="text-xs text-slate-500">最初の発言をして同期を確かめましょう！</p>
              </div>
            ) : (
              filteredMessages.map((msg) => (
                <div key={msg.id} className="group flex gap-3 md:gap-4 hover:bg-slate-800/20 -mx-2 px-2 py-1.5 rounded-xl transition relative">
                  <img src={msg.senderAvatar} alt={msg.senderName} className="w-10 h-10 rounded-full object-cover shrink-0 border border-slate-700/30" />
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="font-bold text-sm">{msg.senderName}</span>
                      <span className="text-[10px] text-slate-500">{msg.formattedTime}</span>
                      
                      {msg.pinned && (
                        <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-400 font-medium">
                          <Pin size={10} /> ピン留め
                        </span>
                      )}
                    </div>

                    <div className={`text-sm leading-relaxed whitespace-pre-wrap ${darkMode ? 'text-slate-200' : 'text-slate-800'}`}>
                      {msg.content}
                    </div>

                    {/* 添付画像 */}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {msg.attachments.map((file, idx) => (
                          <div key={idx} className="max-w-sm rounded-lg overflow-hidden border border-slate-700/50 bg-slate-900/40">
                            {file.type === 'image' && (
                              <img src={file.url} alt={file.name} className="max-h-60 w-full object-cover" />
                            )}
                            <div className="p-2 flex items-center gap-2 text-xs text-slate-300">
                              <Image size={14} className="text-indigo-400" />
                              <span className="truncate flex-1">{file.name}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* リアクション */}
                    {msg.reactions && msg.reactions.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {msg.reactions.map((react, idx) => {
                          const isReactedByMe = react.users.includes(user?.uid);
                          return (
                            <button
                              key={idx}
                              onClick={() => handleToggleReaction(msg.id, react.emoji)}
                              className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition ${
                                isReactedByMe 
                                  ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300 font-semibold' 
                                  : darkMode ? 'bg-slate-800/80 border-slate-700/60 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-600'
                              }`}
                            >
                              <span>{react.emoji}</span>
                              <span>{react.count}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* スレッド返信カウント */}
                    {msg.replies && msg.replies.length > 0 && (
                      <button
                        onClick={() => setActiveThreadMessage(msg)}
                        className="mt-2 flex items-center gap-2 text-xs font-semibold text-indigo-400 hover:underline"
                      >
                        <Reply size={13} />
                        <span>{msg.replies.length} 件の返信</span>
                      </button>
                    )}
                  </div>

                  {/* メッセージ動作ツールバー */}
                  <div className={`opacity-0 group-hover:opacity-100 transition-opacity absolute right-6 -mt-3 flex items-center gap-0.5 p-1 rounded-lg border shadow-lg ${
                    darkMode ? 'bg-slate-900 border-slate-700 text-slate-300' : 'bg-white border-slate-200 text-slate-600'
                  }`}>
                    {EMOJI_LIST.slice(0, 3).map(emoji => (
                      <button 
                        key={emoji} 
                        onClick={() => handleToggleReaction(msg.id, emoji)}
                        className="p-1 hover:bg-slate-700/30 rounded text-sm"
                      >
                        {emoji}
                      </button>
                    ))}
                    <div className="w-px h-4 bg-slate-700/40 my-auto mx-1" />
                    <button 
                      onClick={() => setActiveThreadMessage(msg)} 
                      className="p-1 hover:bg-slate-700/30 rounded text-slate-400 hover:text-indigo-400" 
                      title="スレッド返信"
                    >
                      <Reply size={15} />
                    </button>
                    <button 
                      onClick={() => handleTogglePin(msg.id, msg.pinned)} 
                      className={`p-1 hover:bg-slate-700/30 rounded ${msg.pinned ? 'text-amber-400' : 'text-slate-400 hover:text-amber-400'}`}
                      title="ピン留め"
                    >
                      <Pin size={15} />
                    </button>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 右側：オンラインメンバーパネル */}
          {showMemberSidebar && (
            <aside className={`w-60 border-l hidden lg:block overflow-y-auto p-4 shrink-0 ${darkMode ? 'bg-slate-900/40 border-slate-800' : 'bg-slate-50/50 border-slate-200'}`}>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                参加メンバー ({members.length})
              </h3>
              <div className="space-y-3">
                {members.map(m => (
                  <div key={m.id} className="flex items-center gap-2.5">
                    <div className="relative shrink-0">
                      <img src={m.avatar} alt={m.name} className="w-8 h-8 rounded-full object-cover" />
                      <div className="absolute -bottom-0.5 -right-0.5">
                        {getStatusBadge(m.status)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">{m.name}</p>
                      <p className="text-[10px] text-slate-400 truncate">{m.role}</p>
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          )}
        </div>

        {/* ===== 送信入力エリア ===== */}
        <div className={`p-4 border-t ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
          {attachedFiles.length > 0 && (
            <div className="flex gap-2 mb-3">
              {attachedFiles.map((file, i) => (
                <div key={i} className="relative group rounded-lg overflow-hidden border border-slate-700 bg-slate-800 p-1 flex items-center gap-2 pr-6">
                  <Image size={16} className="text-indigo-400" />
                  <span className="text-xs text-slate-200 truncate max-w-[120px]">{file.name}</span>
                  <button onClick={() => setAttachedFiles(attachedFiles.filter((_, idx) => idx !== i))} className="absolute right-1 text-slate-400 hover:text-rose-400">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {showEmojiPicker && (
            <div className={`absolute bottom-20 left-6 z-30 p-2 rounded-xl shadow-2xl border flex gap-1 ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
              {EMOJI_LIST.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => { setInputText(prev => prev + emoji); setShowEmojiPicker(false); }}
                  className="p-2 hover:bg-slate-700/30 rounded text-xl transition transform hover:scale-110"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={handleSendMessage} className="relative">
            <textarea
              rows={2}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder={`${isDirectMessage ? currentDMUser?.name : '#' + (currentChannel?.name || '一般')} へリアルタイムメッセージ送信 (Enterで送信)`}
              className={`w-full rounded-xl p-3 pr-24 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 transition ${
                darkMode 
                  ? 'bg-slate-800/80 text-slate-100 placeholder-slate-500 border border-slate-700/60' 
                  : 'bg-slate-100 text-slate-800 placeholder-slate-400 border border-slate-200'
              }`}
            />

            <div className="absolute right-3 bottom-3.5 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                className={`p-1.5 rounded-lg transition ${darkMode ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500'}`}
              >
                <Smile size={18} />
              </button>
              <button
                type="button"
                onClick={handleSimulateFileUpload}
                className={`p-1.5 rounded-lg transition ${darkMode ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500'}`}
              >
                <Paperclip size={18} />
              </button>
              <button
                type="submit"
                disabled={!inputText.trim() && attachedFiles.length === 0}
                className="p-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 transition shadow-md shadow-indigo-600/30"
              >
                <Send size={16} />
              </button>
            </div>
          </form>
        </div>
      </main>

      {/* ===== スレッドパネル ===== */}
      {activeThreadMessage && (
        <div className={`w-80 md:w-96 border-l flex flex-col h-full z-20 shrink-0 ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <Reply size={16} /> スレッド返信
            </h3>
            <button onClick={() => setActiveThreadMessage(null)} className="p-1 text-slate-400">
              <X size={18} />
            </button>
          </div>

          <div className="p-4 border-b bg-slate-800/10 text-xs">
            <span className="font-bold">{activeThreadMessage.senderName}</span>
            <p className="mt-1 text-slate-300">{activeThreadMessage.content}</p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {activeThreadMessage.replies?.map((reply) => (
              <div key={reply.id} className="flex gap-2.5 text-xs">
                <img src={reply.senderAvatar} alt={reply.senderName} className="w-7 h-7 rounded-full object-cover shrink-0" />
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold">{reply.senderName}</span>
                    <span className="text-[10px] text-slate-500">{reply.formattedTime}</span>
                  </div>
                  <p className="mt-0.5 text-slate-300">{reply.content}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 border-t">
            <form onSubmit={handleSendThreadReply} className="flex gap-2">
              <input
                type="text"
                value={threadInputText}
                onChange={(e) => setThreadInputText(e.target.value)}
                placeholder="返信を入力..."
                className={`flex-1 rounded-lg px-3 py-2 text-xs focus:outline-none ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-100'}`}
              />
              <button type="submit" className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold">
                送信
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ===== チャンネル作成モーダル ===== */}
      {showCreateChannelModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className={`w-full max-w-md rounded-2xl p-6 shadow-2xl border ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white'}`}>
            <h3 className="font-bold text-lg mb-4">新規チャンネル作成</h3>
            <form onSubmit={handleCreateChannel} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">チャンネル名</label>
                <input 
                  type="text" 
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  placeholder="例: project-x"
                  className={`w-full rounded-lg px-3 py-2 text-sm focus:outline-none ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-100'}`}
                  required 
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">概要</label>
                <input 
                  type="text" 
                  value={newChannelDesc}
                  onChange={(e) => setNewChannelDesc(e.target.value)}
                  placeholder="チャンネルの目的を入力"
                  className={`w-full rounded-lg px-3 py-2 text-sm focus:outline-none ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-100'}`}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowCreateChannelModal(false)} className="flex-1 py-2 text-xs font-semibold rounded-xl border border-slate-700">
                  キャンセル
                </button>
                <button type="submit" className="flex-1 py-2 text-xs font-semibold rounded-xl bg-indigo-600 text-white">
                  作成する
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===== プロフィール編集モーダル ===== */}
      {showProfileModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className={`w-full max-w-md rounded-2xl p-6 shadow-2xl border ${darkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'}`}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-lg">プロフィール設定</h3>
              <button onClick={() => setShowProfileModal(false)} className="p-1 text-slate-400">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">名前</label>
                <input 
                  type="text" 
                  value={userProfile.name}
                  onChange={(e) => setUserProfile(prev => ({ ...prev, name: e.target.value }))}
                  className={`w-full rounded-lg px-3 py-2 text-sm ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-100'}`}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">役職 / 部署</label>
                <input 
                  type="text" 
                  value={userProfile.role}
                  onChange={(e) => setUserProfile(prev => ({ ...prev, role: e.target.value }))}
                  className={`w-full rounded-lg px-3 py-2 text-sm ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-100'}`}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">ステータスメッセージ</label>
                <input 
                  type="text" 
                  value={userProfile.statusText}
                  onChange={(e) => setUserProfile(prev => ({ ...prev, statusText: e.target.value }))}
                  className={`w-full rounded-lg px-3 py-2 text-sm ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-100'}`}
                />
              </div>

              <button
                onClick={handleSaveProfile}
                className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-500 transition mt-2"
              >
                保存する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== メッセージ検索モーダル ===== */}
      {showSearchModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-start justify-center pt-20 p-4">
          <div className={`w-full max-w-xl rounded-2xl shadow-2xl border overflow-hidden ${darkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white'}`}>
            <div className="p-4 border-b flex items-center gap-3">
              <Search size={18} className="text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="全メッセージから検索..."
                className="flex-1 bg-transparent text-sm focus:outline-none"
                autoFocus
              />
              <button onClick={() => setShowSearchModal(false)} className="text-slate-400 text-xs px-2 py-1 rounded bg-slate-800">
                ESC
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto p-4 space-y-3">
              {messages
                .filter(m => m.content.toLowerCase().includes(searchQuery.toLowerCase()) && searchQuery.trim())
                .map((result) => (
                  <div 
                    key={result.id}
                    onClick={() => {
                      setActiveTab(result.targetId);
                      setIsDirectMessage(result.isDM);
                      setShowSearchModal(false);
                    }}
                    className="p-3 rounded-xl border border-slate-800 hover:border-indigo-500/50 cursor-pointer transition"
                  >
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span className="font-semibold text-indigo-400">{result.senderName}</span>
                      <span>{result.formattedTime}</span>
                    </div>
                    <p className="text-xs text-slate-300 line-clamp-2">{result.content}</p>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}