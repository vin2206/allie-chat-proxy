// AllieChat.jsx
import { useState } from 'react';
import axios from 'axios';
import './ChatUI.css';

export default function AllieChat() {
  const [messages, setMessages] = useState([
    { sender: 'allie', text: 'Hi baby, how are you? Did you miss me?' }
  ]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);

  const sendMessage = async () => {
    if (!input.trim()) return;

    const newMessages = [...messages, { sender: 'user', text: input }];
    setMessages(newMessages);
    setInput('');
    setTyping(true);

    try {
      const response = await axios.post('https://allie-chat-proxy-production.up.railway.app/chat',
  {
  messages: newMessages.map(msg => ({
    role: msg.sender === 'user' ? 'user' : 'assistant',
    content: msg.text
  }))
},
  {
    headers: {
      'Content-Type': 'application/json'
    }
  }
);

      const reply = response.data.reply || "I'm thinking...";
      setMessages([...newMessages, { sender: 'allie', text: reply }]);
    } catch (error) {
      setMessages([...newMessages, { sender: 'allie', text: 'Sorry baby, something went wrong. Let me take a nap and try again later.' }]);
    } finally {
      setTyping(false);
    }
  };

 return (
  <>
    {/* Header */}
    <div className="header">
      <div className="profile-pic">
        <img
          src="https://i.postimg.cc/MXYTwd25/image-39.png"
          alt="Allie"
          style={{ width: '100%', height: '100%', borderRadius: '50%' }}
        />
        <div className="live-dot" />
      </div>
      <div>
        <div className="username">Allie</div>
        <div className="text-sm text-green-400">Online</div>
      </div>
    </div>

    {/* Chat messages */}
    <div className="chat-container">
      {messages.slice().reverse().map((msg, index) => (
        <div key={index} className={`message ${msg.sender === 'user' ? 'user-message' : 'allie-message'}`}>
          {msg.text}
        </div>
      ))}
      {typing && (
        <div className="text-sm text-gray-400 italic">Allie is typing...</div>
      )}
    </div>

    {/* Footer */}
    <footer className="p-4 bg-gray-900 border-t border-gray-700 flex items-center gap-2">
      <input
        className="flex-1 p-2 rounded-lg bg-gray-800 text-white outline-none"
        type="text"
        value={input}
        placeholder="Type a message..."
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && sendMessage()}
      />
      <button
        onClick={sendMessage}
        className="px-4 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg shadow-lg"
      >
        Send
      </button>
    </footer>
  </>
