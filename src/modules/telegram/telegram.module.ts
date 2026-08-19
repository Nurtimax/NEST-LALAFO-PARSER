import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { MalbazarModule } from '../malbazar/malbazar.module';
import { TelegramStateService } from './telegram-state.service';
import { TelegramNotifyService } from './telegram-notify.service';
import { TelegramUpdate } from './telegram.update';

@Module({
  imports: [
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        token: config.getOrThrow<string>('TELEGRAM_BOT_TOKEN'),
      }),
    }),
    MalbazarModule,
  ],
  providers: [TelegramStateService, TelegramNotifyService, TelegramUpdate],
  exports: [TelegramNotifyService],
})
export class TelegramModule {}
