// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDq6T8B-BM--Wy5b0aUuthkmZD8f6nR1ag",
  authDomain: "cargas-ba762.firebaseapp.com",
  projectId: "cargas-ba762",
  storageBucket: "cargas-ba762.firebasestorage.app",
  messagingSenderId: "822192574714",
  appId: "1:822192574714:web:fab516ed9375e85df53943",
  measurementId: "G-CMCVQQMFSC"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);