import { useState, useEffect, useRef } from 'react';
import Gun from 'gun';
import 'gun/sea';

// Initialize Gun with public relay servers - NO CONFIGURATION NEEDED!
const gun = Gun({
  peers: [
    'https://gun-manhattan.herokuapp.com/gun',
    'https://gun-us.herokuapp.com/gun',
    'https://gun-eu.herokuapp.com/gun'
  ]
});

// Types
interface Message {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: number;
  read: boolean;
}

interface Contact {
  id: string;
  name: string;
  addedAt: number;
}

// Generate or retrieve device ID
const getDeviceId = (): string => {
  let id = localStorage.getItem('quickchat_device_id');
  if (!id) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    id = '';
    for (let i = 0; i < 6; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    localStorage.setItem('quickchat_device_id', id);
  }
  return id;
};

// Get chat room ID (sorted to ensure same room for both users)
const getChatRoomId = (id1: string, id2: string): string => {
  return [id1, id2].sort().join('_');
};

export default function App() {
  const [deviceId] = useState(getDeviceId);
  const [contacts, setContacts] = useState<Contact[]>(() => {
    const saved = localStorage.getItem('quickchat_contacts');
    return saved ? JSON.parse(saved) : [];
  });
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [newContactId, setNewContactId] = useState('');
  const [showAddContact, setShowAddContact] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [copied, setCopied] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Save contacts to localStorage
  useEffect(() => {
    localStorage.setItem('quickchat_contacts', JSON.stringify(contacts));
  }, [contacts]);

  // Set online status
  useEffect(() => {
    const presence = gun.get('quickchat_presence');
    
    // Set self as online
    presence.get(deviceId).put({ online: true, lastSeen: Date.now() });
    
    // Update presence every 30 seconds
    const interval = setInterval(() => {
      presence.get(deviceId).put({ online: true, lastSeen: Date.now() });
    }, 30000);
    
    // Listen for online status of contacts
    contacts.forEach(contact => {
      presence.get(contact.id).on((data: { online: boolean; lastSeen: number } | null) => {
        if (data && data.lastSeen && Date.now() - data.lastSeen < 60000) {
          setOnlineUsers(prev => new Set([...prev, contact.id]));
        } else {
          setOnlineUsers(prev => {
            const next = new Set(prev);
            next.delete(contact.id);
            return next;
          });
        }
      });
    });
    
    // Set offline on close
    const handleClose = () => {
      presence.get(deviceId).put({ online: false, lastSeen: Date.now() });
    };
    window.addEventListener('beforeunload', handleClose);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleClose);
    };
  }, [deviceId, contacts]);

  // Listen for messages from all contacts
  useEffect(() => {
    contacts.forEach(contact => {
      const roomId = getChatRoomId(deviceId, contact.id);
      const room = gun.get('quickchat_rooms').get(roomId);
      
      room.map().on((data: Message | null, key: string) => {
        if (data && data.text && key) {
          setMessages(prev => {
            const exists = prev.some(m => m.id === data.id);
            if (exists) return prev;
            const newMessages = [...prev, { ...data, id: data.id || key }]
              .sort((a, b) => a.timestamp - b.timestamp);
            
            // Count unread from this contact
            if (data.from === contact.id && data.to === deviceId && !data.read) {
              setUnreadCounts(prevCounts => ({
                ...prevCounts,
                [contact.id]: (prevCounts[contact.id] || 0) + 1
              }));
            }
            
            return newMessages;
          });
        }
      });
    });
  }, [contacts, deviceId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedContact]);

  // Mark messages as read when viewing chat
  useEffect(() => {
    if (selectedContact) {
      setUnreadCounts(prev => ({ ...prev, [selectedContact.id]: 0 }));
      
      // Mark messages as read in Gun
      const roomId = getChatRoomId(deviceId, selectedContact.id);
      messages
        .filter(m => m.from === selectedContact.id && !m.read)
        .forEach(m => {
          gun.get('quickchat_rooms').get(roomId).get(m.id).put({ ...m, read: true });
        });
    }
  }, [selectedContact, messages, deviceId]);

  const addContact = () => {
    const cleanId = newContactId.toUpperCase().trim();
    if (cleanId.length !== 6) {
      alert('Please enter a valid 6-character ID');
      return;
    }
    if (cleanId === deviceId) {
      alert("You can't add yourself!");
      return;
    }
    if (contacts.some(c => c.id === cleanId)) {
      alert('Contact already exists!');
      return;
    }
    
    setContacts(prev => [...prev, { id: cleanId, name: cleanId, addedAt: Date.now() }]);
    setNewContactId('');
    setShowAddContact(false);
  };

  const sendMessage = () => {
    if (!inputText.trim() || !selectedContact) return;
    
    const roomId = getChatRoomId(deviceId, selectedContact.id);
    const msgId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const message: Message = {
      id: msgId,
      from: deviceId,
      to: selectedContact.id,
      text: inputText.trim(),
      timestamp: Date.now(),
      read: false
    };
    
    gun.get('quickchat_rooms').get(roomId).get(msgId).put(message);
    setInputText('');
    inputRef.current?.focus();
  };

  const copyId = () => {
    navigator.clipboard.writeText(deviceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const deleteContact = (contactId: string) => {
    if (confirm('Delete this contact and all messages?')) {
      setContacts(prev => prev.filter(c => c.id !== contactId));
      setMessages(prev => prev.filter(m => m.from !== contactId && m.to !== contactId));
      if (selectedContact?.id === contactId) {
        setSelectedContact(null);
      }
    }
  };

  const renameContact = (contact: Contact) => {
    const newName = prompt('Enter new name:', contact.name);
    if (newName && newName.trim()) {
      setContacts(prev => prev.map(c => 
        c.id === contact.id ? { ...c, name: newName.trim() } : c
      ));
    }
  };

  const filteredMessages = selectedContact
    ? messages.filter(m => 
        (m.from === deviceId && m.to === selectedContact.id) ||
        (m.from === selectedContact.id && m.to === deviceId)
      )
    : [];

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + 
           date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="app">
      {/* Sidebar */}
      <div className={`sidebar ${showSidebar ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h1>💬 QuickChat</h1>
          <button className="menu-btn" onClick={() => setShowSidebar(false)}>✕</button>
        </div>
        
        <div className="my-id" onClick={copyId}>
          <div className="id-label">Your ID (tap to copy)</div>
          <div className="id-value">
            {deviceId}
            <span className="copy-icon">{copied ? '✓' : '📋'}</span>
          </div>
        </div>
        
        <div className="contacts-header">
          <span>Contacts ({contacts.length})</span>
          <button className="add-btn" onClick={() => setShowAddContact(true)}>+ Add</button>
        </div>
        
        <div className="contacts-list">
          {contacts.length === 0 ? (
            <div className="empty-contacts">
              <p>No contacts yet</p>
              <p className="hint">Share your ID with friends or add theirs!</p>
            </div>
          ) : (
            contacts.map(contact => (
              <div
                key={contact.id}
                className={`contact-item ${selectedContact?.id === contact.id ? 'active' : ''}`}
                onClick={() => {
                  setSelectedContact(contact);
                  setShowSidebar(false);
                }}
              >
                <div className="contact-avatar">
                  {contact.name[0].toUpperCase()}
                  {onlineUsers.has(contact.id) && <span className="online-dot" />}
                </div>
                <div className="contact-info">
                  <div className="contact-name">{contact.name}</div>
                  <div className="contact-id">{contact.id}</div>
                </div>
                {unreadCounts[contact.id] > 0 && (
                  <div className="unread-badge">{unreadCounts[contact.id]}</div>
                )}
                <div className="contact-actions">
                  <button onClick={(e) => { e.stopPropagation(); renameContact(contact); }}>✏️</button>
                  <button onClick={(e) => { e.stopPropagation(); deleteContact(contact.id); }}>🗑️</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="main">
        {!selectedContact ? (
          <div className="welcome">
            <div className="welcome-content">
              <div className="welcome-icon">💬</div>
              <h2>Welcome to QuickChat!</h2>
              <p>Free instant messaging - no signup required</p>
              
              <div className="welcome-steps">
                <div className="step">
                  <span className="step-num">1</span>
                  <span>Share your ID: <strong onClick={copyId} className="clickable">{deviceId} 📋</strong></span>
                </div>
                <div className="step">
                  <span className="step-num">2</span>
                  <span>Add a friend's ID</span>
                </div>
                <div className="step">
                  <span className="step-num">3</span>
                  <span>Start chatting!</span>
                </div>
              </div>
              
              <button className="welcome-add-btn" onClick={() => setShowAddContact(true)}>
                + Add Contact
              </button>
            </div>
            <button className="mobile-menu" onClick={() => setShowSidebar(true)}>☰</button>
          </div>
        ) : (
          <>
            <div className="chat-header">
              <button className="back-btn" onClick={() => setShowSidebar(true)}>☰</button>
              <div className="chat-contact-info">
                <div className="chat-avatar">
                  {selectedContact.name[0].toUpperCase()}
                  {onlineUsers.has(selectedContact.id) && <span className="online-dot" />}
                </div>
                <div>
                  <div className="chat-name">{selectedContact.name}</div>
                  <div className="chat-status">
                    {onlineUsers.has(selectedContact.id) ? '🟢 Online' : '⚪ Offline'}
                  </div>
                </div>
              </div>
            </div>

            <div className="messages">
              {filteredMessages.length === 0 ? (
                <div className="no-messages">
                  <p>No messages yet</p>
                  <p className="hint">Say hello! 👋</p>
                </div>
              ) : (
                filteredMessages.map(msg => (
                  <div
                    key={msg.id}
                    className={`message ${msg.from === deviceId ? 'sent' : 'received'}`}
                  >
                    <div className="message-bubble">
                      <div className="message-text">{msg.text}</div>
                      <div className="message-meta">
                        <span className="message-time">{formatTime(msg.timestamp)}</span>
                        {msg.from === deviceId && (
                          <span className="message-status">{msg.read ? '✓✓' : '✓'}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="input-area">
              <input
                ref={inputRef}
                type="text"
                placeholder="Type a message..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              />
              <button className="send-btn" onClick={sendMessage} disabled={!inputText.trim()}>
                ➤
              </button>
            </div>
          </>
        )}
      </div>

      {/* Add Contact Modal */}
      {showAddContact && (
        <div className="modal-overlay" onClick={() => setShowAddContact(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add Contact</h3>
            <p>Enter your friend's 6-character ID</p>
            <input
              type="text"
              placeholder="e.g., ABC123"
              value={newContactId}
              onChange={(e) => setNewContactId(e.target.value.toUpperCase().slice(0, 6))}
              onKeyPress={(e) => e.key === 'Enter' && addContact()}
              maxLength={6}
              autoFocus
            />
            <div className="modal-buttons">
              <button className="cancel-btn" onClick={() => setShowAddContact(false)}>Cancel</button>
              <button className="confirm-btn" onClick={addContact}>Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
