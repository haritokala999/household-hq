This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

The app uses local system font stacks so production builds do not depend on fetching fonts from an external service.

## Statement imports

The transaction importer parses CSV files and text-based Capital One PDF statements in memory. Imported transactions are associated with the signed-in household member and are not linked to a financial account. It requires the existing `NEXT_PUBLIC_FIREBASE_PROJECT_ID` setting and server-side Firebase Admin credentials: either Application Default Credentials in the Node.js runtime or a protected `FIREBASE_SERVICE_ACCOUNT_JSON` environment variable. Never expose the service-account value to the browser or commit it. The application server must run in a Node.js environment; `firebase.json` configures Firestore rules and the local emulator, not Next.js API hosting.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
