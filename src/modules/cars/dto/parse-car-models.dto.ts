import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl } from 'class-validator';

export class ParseCarModelsDto {
  @ApiProperty({
    description: 'Brand page URL, e.g. from POST /cars/parse-brands',
  })
  @IsUrl()
  url: string;

  @ApiProperty({ description: 'Brand display name, e.g. "Toyota"' })
  @IsString()
  name: string;

  @ApiProperty({
    required: false,
    description:
      'Folder slug under public/api/cars/ (defaults to a slugified name)',
  })
  @IsOptional()
  @IsString()
  slug?: string;
}
