import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { loginGuard } from './core/guards/login.guard';
import { packIdResolver, resolveActivePackIdForRedirect } from './core/resolvers/pack-id.resolver';
import { PacksService } from './core/services/packs.service';

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
      { path: '', pathMatch: 'full', redirectTo: 'questions' },
      {
        path: 'questions',
        children: [
          {
            path: '',
            pathMatch: 'full',
            redirectTo: () => resolveActivePackIdForRedirect(inject(PacksService)).then((id) => `/questions/${id}`),
          },
          {
            path: ':packId',
            resolve: { packId: packIdResolver },
            loadComponent: () =>
              import('./features/questions/questions-page.component').then((m) => m.QuestionsPageComponent),
          },
          {
            path: ':packId/:questionId',
            resolve: { packId: packIdResolver },
            loadComponent: () =>
              import('./features/questions/questions-page.component').then((m) => m.QuestionsPageComponent),
          },
          {
            path: ':packId/import/:jobId',
            resolve: { packId: packIdResolver },
            loadComponent: () =>
              import('./features/import-review/import-review-page.component').then(
                (m) => m.ImportReviewPageComponent,
              ),
          },
        ],
      },
      {
        path: 'import',
        children: [
          {
            path: '',
            pathMatch: 'full',
            redirectTo: () => resolveActivePackIdForRedirect(inject(PacksService)).then((id) => `/import/${id}`),
          },
          {
            path: ':packId',
            resolve: { packId: packIdResolver },
            data: { packRedirectPrefix: '/import' },
            loadComponent: () =>
              import('./features/import-exam/import-exam-page.component').then((m) => m.ImportExamPageComponent),
          },
        ],
      },
      {
        path: 'quiz',
        loadComponent: () => import('./features/quiz/quiz.component').then((m) => m.QuizComponent),
      },
      {
        path: 'transcripts',
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/transcripts/transcripts-page.component').then((m) => m.TranscriptsPageComponent),
          },
          {
            path: ':scriptId',
            loadComponent: () =>
              import('./features/transcripts/transcripts-page.component').then((m) => m.TranscriptsPageComponent),
          },
        ],
      },
      {
        path: 'chat',
        children: [
          {
            path: '',
            loadComponent: () => import('./features/chat/chat-page.component').then((m) => m.ChatPageComponent),
          },
          {
            path: ':chatId',
            loadComponent: () => import('./features/chat/chat-page.component').then((m) => m.ChatPageComponent),
          },
        ],
      },
      {
        path: 'export',
        loadComponent: () => import('./features/export/export.component').then((m) => m.ExportComponent),
      },
      {
        path: 'costs',
        loadComponent: () => import('./features/costs/costs-page.component').then((m) => m.CostsPageComponent),
      },
      { path: '**', redirectTo: 'questions' },
    ],
  },
  { path: '**', redirectTo: '' },
];
