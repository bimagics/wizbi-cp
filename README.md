# WIZBI Control-Plane (Unified Service) 🚀

## 1. חזון הפלטפורמה: "מערכת הפעלה" לעסקים על GCP

המטרה שלנו היא לבנות פלטפורמה כשירות (PaaS) שתאפשר לעסקים, גם ללא ידע טכנולוגי, לקבל תשתית ענן מלאה, מודרנית ומאובטחת על גבי Google Cloud Platform. אנחנו מורידים מהם את כל המורכבות של ניהול תשתיות, ומספקים להם ממשק ניהול פשוט שדרכו הם יכולים להקים ולנהל מוצרים דיגיטליים.

החזון ארוך הטווח הוא לאפשר פיתוח של מוצרים אלו באמצעות AI בשפה טבעית, כאשר הפלטפורמה שלנו דואגת אוטומטית לכל "עבודת הצנרת" מאחורי הקלעים.

---

## 2. ארכיטקטורה ועקרונות מנחים

כל החלטה טכנולוגית מונחית על ידי העקרונות הבאים:
-   **פשטות קיצונית (Radical Simplicity):** המשתמש מקבל ממשק נקי ואינטואיטיבי. המורכבות נשארת "מתחת למכסה המנוע".
-   **יעילות ועלות נמוכה (Lean & Cost-Effective):** ארכיטקטורה מבוססת Serverless (Cloud Run, Firestore) כדי למזער עלויות קבועות.
-   **אבטחה מובנית (Secure by Design):** סביבות מבודדות לחלוטין והרשאות מינימליות (Least Privilege).
-   **ניהול מבוסס תבניות (Template-Driven):** אחידות, מניעת טעויות וקלות בשדרוגים רוחביים.

### המבנה ההיררכי
1.  **הפלטפורמה המרכזית (Control Plane):** פרויקט GCP (`wizbi-cp`) עם אפליקציית Node.js על Cloud Run ו-Firestore. זהו "המוח" של המערכת.
2.  **הארגון (Organization):** ייצוג של לקוח. ממומש כ-Folder ב-GCP וכ-Team ב-GitHub.
3.  **הפרויקט (Project):** המוצר/התשתית של הלקוח. ממומש כפרויקט GCP נפרד ומאגר קוד (Repository) פרטי ב-GitHub.

---

## 3. ✨ שיטת העבודה שלנו (AI-First Workflow)

**חשוב:** אנו עובדים בסביבה מודרנית לחלוטין, ללא פיתוח מקומי.

-   **אין IDE לוקאלי:** אנחנו לא מריצים קוד על המחשבים האישיים שלנו.
-   **הכל דרך GitHub ו-Cloud Shell:** כל שינויי הקוד מתבצעים ישירות בממשק של GitHub. כל פעולות התשתית והבדיקה מתבצעות דרך Cloud Shell.
-   **פיתוח מבוסס צ'אט עם AI:** התהליך המרכזי הוא שיחה עם מנוע AI (כמו Gemini). אנחנו מתארים את הדרישות, מקבלים קטעי קוד מלאים, ומדביקים אותם בקבצים המתאימים ב-GitHub. המנוע הוא השותף שלנו לכתיבת הקוד.

שיטה זו מבטיחה מהירות, אחידות, ומאפשרת לנו להתרכז בפתרון הבעיות העסקיות במקום בהגדרות סביבה.

---

## 4. 🚀 Quick Start (הקמת הפרויקט מאפס)

### שלב א': הרצת סקריפט ה-Bootstrap ב-Cloud Shell
פתח את Cloud Shell והרץ את הפקודה הבאה לאחר שמילאת את הפרטים שלך:

```bash
PROJECT_ID="wizbi-cp" REGION="europe-west1" FIRESTORE_LOCATION="eur3" AR_REPO="wizbi" BILLING_ACCOUNT="XXXXXX-XXXXXX-XXXXXX" GITHUB_OWNER="YOUR_GH_ORG_OR_USER" GITHUB_REPO="wizbi-cp" WIF_POOL="github-pool" WIF_PROVIDER="github-provider" HOSTING_SITE="wizbi-cp" bash -c 'git clone [https://github.com/$](https://github.com/$){GITHUB_OWNER}/${GITHUB_REPO}.git && cd ${GITHUB_REPO} && chmod +x tools/bootstrap_cp.sh && ./tools/bootstrap_cp.sh'
