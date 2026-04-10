import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, getDocs, collection, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyByKFdK4oCySxmJ9zF3-jaADbUMgzO5nN8",
  authDomain: "meme-smash-9ac89.firebaseapp.com",
  projectId: "meme-smash-9ac89",
  storageBucket: "meme-smash-9ac89.firebasestorage.app",
  messagingSenderId: "476432285431",
  appId: "1:476432285431:web:e2da4aae2aedc4830f9df2",
  measurementId: "G-3V0XDY6CTM" // Optional
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Cloud Firestore and get a reference to the service
export const db = getFirestore(app);
