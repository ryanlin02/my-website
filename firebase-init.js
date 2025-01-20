// firebase-init.js

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from './firebase-config.js';

// 初始化 Firebase
const app = initializeApp(firebaseConfig);

// 取得 Auth 實例
const auth = getAuth(app);

// 取得 Firestore 實例
const db = getFirestore(app);

// 導出以供其他檔案使用
export { app, auth, db };
