import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Mail, MessageSquare, MoreHorizontal, Phone, Users, Video,
  type LucideIcon,
} from 'lucide-react'
import type { InteractionChannel, InteractionDirection } from '@/people/types'

export const CHANNEL_ICONS: Record<InteractionChannel, LucideIcon> = {
  in_person: Users,
  call: Phone,
  video: Video,
  text: MessageSquare,
  email: Mail,
  other: MoreHorizontal,
}

export const CHANNEL_LABEL_KEYS: Record<InteractionChannel, string> = {
  in_person: 'people.channel.in_person',
  call: 'people.channel.call',
  video: 'people.channel.video',
  text: 'people.channel.text',
  email: 'people.channel.email',
  other: 'people.channel.other',
}

export const DIRECTION_ICONS: Record<InteractionDirection, LucideIcon> = {
  outbound: ArrowUpRight,
  inbound: ArrowDownLeft,
  mutual: ArrowLeftRight,
}

export const DIRECTION_LABEL_KEYS: Record<InteractionDirection, string> = {
  outbound: 'people.direction.outbound',
  inbound: 'people.direction.inbound',
  mutual: 'people.direction.mutual',
}
