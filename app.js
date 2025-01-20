// app.js

import { auth } from './firebase-init.js';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

// 當網頁載入完成時
document.addEventListener('DOMContentLoaded', function() {
    // 找到登入按鈕
    const loginButton = document.getElementById('loginButton');

    // 添加點擊事件
    loginButton.addEventListener('click', async () => {
        try {
            // 建立 Google 登入提供者
            const provider = new GoogleAuthProvider();
            
            // 嘗試登入
            const result = await signInWithPopup(auth, provider);
            
            // 登入成功
            console.log('登入成功！', result.user);
            alert('登入成功！');
            
        } catch (error) {
            // 登入失敗
            console.error('登入錯誤：', error);
            alert('登入失敗：' + error.message);
        }
    });
});
