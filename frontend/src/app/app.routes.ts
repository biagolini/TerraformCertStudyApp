import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { loginGuard } from './core/guards/login.guard';
import { packIdResolver } from './core/resolvers/pack-id.resolver';

/**
 * Two levels: global pages (Home, Profile, Settings, Costs) and the
 * certification workspace at /exam/:packId, whose tabs are child routes.
 * The workspace resolver makes the URL's packId the active certification,
 * so every pack-scoped page under it reads the right data on first render.
 */
export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login.component').then((m) => m.LoginComponent),
    canActivate: [loginGuard],
  },
  {
    path: '',
    loadComponent: () => import('./app.component').then((m) => m.AppComponent),
    canActivate: [authGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./features/home/home-page.component').then((m) => m.HomePageComponent),
      },
      {
        path: 'profile',
        loadComponent: () => import('./features/profile/profile-page.component').then((m) => m.ProfilePageComponent),
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/settings/settings-page.component').then((m) => m.SettingsPageComponent),
      },
      {
        path: 'costs',
        loadComponent: () => import('./features/costs/costs-page.component').then((m) => m.CostsPageComponent),
      },
      {
        path: 'exam/:packId',
        resolve: { packId: packIdResolver },
        runGuardsAndResolvers: 'paramsChange',
        loadComponent: () =>
          import('./features/workspace/exam-workspace.component').then((m) => m.ExamWorkspaceComponent),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'banks' },
          {
            path: 'banks',
            loadComponent: () => import('./features/banks/banks-page.component').then((m) => m.BanksPageComponent),
          },
          {
            path: 'banks/:bankId',
            loadComponent: () =>
              import('./features/questions/questions-page.component').then((m) => m.QuestionsPageComponent),
          },
          {
            path: 'banks/:bankId/:questionId',
            loadComponent: () =>
              import('./features/questions/questions-page.component').then((m) => m.QuestionsPageComponent),
          },
          {
            path: 'import',
            loadComponent: () =>
              import('./features/import-exam/import-exam-page.component').then((m) => m.ImportExamPageComponent),
          },
          {
            path: 'import/:jobId',
            loadComponent: () =>
              import('./features/import-review/import-review-page.component').then((m) => m.ImportReviewPageComponent),
          },
          {
            path: 'quiz',
            loadComponent: () => import('./features/quiz/quiz.component').then((m) => m.QuizComponent),
          },
          {
            path: 'performance',
            loadComponent: () =>
              import('./features/performance/performance-page.component').then((m) => m.PerformancePageComponent),
          },
          {
            path: 'notes',
            loadComponent: () => import('./features/notes/notes-page.component').then((m) => m.NotesPageComponent),
          },
          {
            path: 'notes/:noteId',
            loadComponent: () => import('./features/notes/notes-page.component').then((m) => m.NotesPageComponent),
          },
          {
            path: 'transcripts',
            loadComponent: () =>
              import('./features/transcripts/transcripts-page.component').then((m) => m.TranscriptsPageComponent),
          },
          {
            path: 'transcripts/:scriptId',
            loadComponent: () =>
              import('./features/transcripts/transcripts-page.component').then((m) => m.TranscriptsPageComponent),
          },
          {
            path: 'chat',
            loadComponent: () => import('./features/chat/chat-page.component').then((m) => m.ChatPageComponent),
          },
          {
            path: 'chat/:chatId',
            loadComponent: () => import('./features/chat/chat-page.component').then((m) => m.ChatPageComponent),
          },
          {
            path: 'export',
            loadComponent: () => import('./features/export/export.component').then((m) => m.ExportComponent),
          },
          { path: '**', redirectTo: 'banks' },
        ],
      },
      { path: '**', redirectTo: '' },
    ],
  },
  { path: '**', redirectTo: '' },
];
