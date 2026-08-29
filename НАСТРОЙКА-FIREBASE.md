# Настройка перед установкой (один раз, ~10 минут)

Нужно завести два бесплатных сервиса: Firebase (логин + база данных) и
Cloudinary (хранение фото). Карта нигде не нужна.

## 1. Firebase — логин и база данных

1. Открой https://console.firebase.google.com/ → **Add project**
2. Назови проект, например `vahta-dosatuy` → Google Analytics можно
   выключить → **Create project**
3. Слева в меню: **Build → Authentication → Get started**
   → вкладка **Sign-in method** → **Email/Password** → включить → Save
4. Слева: **Build → Firestore Database → Create database**
   → выбери любой регион (например `eur3` или ближайший) →
   **Start in production mode** → Enable
5. Слева: **Firestore Database → Rules** → вставь текст ниже вместо
   того, что там есть → **Publish**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId} {
         allow read: if request.auth != null;
         allow write: if request.auth != null && request.auth.uid == userId;
       }
       match /ttnDocs/{docId} {
         allow read, create: if request.auth != null;
         allow update, delete: if request.auth != null && (
           request.auth.uid == resource.data.uploadedByUid ||
           get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'manager'
         );
       }
       match /maintenanceDocs/{docId} {
         allow read, create: if request.auth != null;
         allow update, delete: if request.auth != null && (
           request.auth.uid == resource.data.uploadedByUid ||
           get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'manager'
         );
       }
       match /chatMessages/{msgId} {
         allow read, create: if request.auth != null;
         allow delete: if request.auth != null && (
           request.auth.uid == resource.data.senderUid ||
           get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'manager'
         );
       }
       match /settings/{docId} {
         allow read: if request.auth != null;
         allow write: if request.auth != null
           && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'manager';
       }
     }
   }
   ```

6. Слева вверху: значок шестерёнки → **Project settings** → внизу
   раздела **Your apps** нажми иконку **</>** (Web) → назови приложение
   `vahta-web` → **Register app** (галку Firebase Hosting не ставь)
7. Появится блок кода `const firebaseConfig = {...}` — скопируй именно
   этот объект целиком, пришли его мне (или сам вставишь в
   `firebase-config.js`, я покажу куда).

## 2. Cloudinary — хранение фото ТТН

1. Открой https://cloudinary.com/users/register/free → зарегистрируйся
   (карта не требуется)
2. На главной странице Dashboard сверху увидишь **Cloud name** —
   скопируй его
3. Слева: **Settings (шестерёнка) → Upload** → раздел **Upload presets**
   → **Add upload preset**
   - **Signing Mode: Unsigned**
   - Preset name можно оставить как есть или назвать `ttn_unsigned`
   - Save
4. Пришли мне: Cloud name + имя пресета (или сам впишешь в
   `cloud-config.js`)

## Что дальше

Как только у тебя будут:
- объект `firebaseConfig` из шага 1.7
- Cloud name и preset name из шага 2

— пришли их мне (или впиши сам в файлы `firebase-config.js` и
`cloud-config.js`, они уже с подписанными местами для вставки) и
залей обновлённые файлы в репозиторий на GitHub.
