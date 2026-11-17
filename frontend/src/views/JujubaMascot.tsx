import { useEffect, useId, useRef, type CSSProperties } from 'react'
import jujuba from '../assets/jujuba.png'
import type { MascotMeetingKind } from '../models/flowMascot'
import type { FlightFrame, Point } from '../controllers/mascotMotion'
import { MascotHat, type Hat } from './MascotHat'

export function JujubaMascot({ hero = false, followPointer = false, grabbed = false, reaction, flight, hat = 'none', greeting, direction }: {
  hero?: boolean; followPointer?: boolean; grabbed?: boolean
  reaction?: 'protesting' | 'scared' | 'wary' | 'relieved' | null
  flight?: FlightFrame | null
  hat?: Hat
  greeting?: MascotMeetingKind
  direction?: Point
}) {
  const id = useId()
  const mascot = useRef<HTMLSpanElement>(null)
  const leftLid = id + '-left'
  const rightLid = id + '-right'
  const mouth = id + '-mouth'
  const cheek = id + '-cheek'
  const leftPupil = id + '-left-pupil'
  const rightPupil = id + '-right-pupil'
  const smile = 'M547 709C587 726 638 705 665 673Q690 644 704 666C715 706 684 747 650 762C610 779 560 756 543 729Q534 715 547 709Z'
  const protesting = reaction === 'protesting'
  const scared = reaction === 'scared' || reaction === 'wary' || !!flight
  const relieved = reaction === 'relieved'
  const kissing = greeting === 'kiss' && !flight
  const watching = !!direction && !flight && !!greeting && ['look', 'hug', 'squeeze', 'kiss', 'dance'].includes(greeting)
  const embracing = !!direction && !flight && !!greeting && ['hug', 'squeeze', 'push', 'kiss'].includes(greeting)
  const towardLeft = (direction?.x ?? 0) < 0
  const squash = flight?.squash ?? 0
  const sideImpact = flight?.edge === 'left' || flight?.edge === 'right'
  const origins = { left: '8% 50%', right: '92% 50%', top: '50% 10%', bottom: '50% 91%' }
  const narrow = 1 - squash * .58
  const wide = 1 + squash * .48

  useEffect(() => {
    const element = mascot.current
    if (!followPointer || !element) return
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let pointerX = 0
    let pointerY = 0
    function look(event: PointerEvent) {
      if (preference.matches || event.pointerType === 'touch') return
      pointerX = event.clientX
      pointerY = event.clientY
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const box = element!.getBoundingClientRect()
        const x = pointerX - box.left - box.width / 2
        const y = pointerY - box.top - box.height / 2
        const distance = Math.max(105, Math.hypot(x, y))
        element!.style.setProperty('--gaze-x', `${x * 35 / distance}px`)
        element!.style.setProperty('--gaze-y', `${y * 24 / distance}px`)
        element!.dataset.looking = 'true'
      })
    }
    function reset() {
      window.cancelAnimationFrame(frame)
      frame = 0
      delete element!.dataset.looking
    }
    function leave(event: PointerEvent) {
      if (!event.relatedTarget) reset()
    }
    window.addEventListener('pointermove', look, { passive: true })
    window.addEventListener('pointerout', leave)
    window.addEventListener('blur', reset)
    return () => {
      reset()
      window.removeEventListener('pointermove', look)
      window.removeEventListener('pointerout', leave)
      window.removeEventListener('blur', reset)
    }
  }, [followPointer])

  return <span ref={mascot} className={'jujuba-mascot' + (hero ? ' jujuba-hero' : '') + (greeting ? ' jujuba-greeting-' + greeting : '')} aria-hidden="true"
    style={{
      ...(direction && greeting ? { '--pair-x': direction.x, '--pair-y': direction.y,
        '--pair-gaze-x': `${direction.x * 43}px`, '--pair-gaze-y': `${direction.y * 27}px` } : {}),
      ...(flight ? {
      scale: sideImpact ? `${narrow} ${wide}` : `${wide} ${narrow}`,
      rotate: `${flight.velocity.x / 195 * (1 - squash)}deg`,
      transformOrigin: origins[flight.edge],
      } : {}),
    } as CSSProperties}>
    {(grabbed || scared) && <svg className="jujuba-arms" viewBox="0 0 1254 1254" aria-hidden="true">
      <path className="jujuba-arm jujuba-arm-left" d="M235 685Q152 670 101 544L72 465" />
      <path className="jujuba-arm jujuba-arm-right" d="M1018 695Q1116 661 1151 539L1181 468" />
    </svg>}
    <img src={jujuba} alt="" draggable={false} />
    <MascotHat hat={hat} />
    {embracing && <svg className="jujuba-pair-arms" viewBox="0 0 1254 1254" aria-hidden="true"
      style={towardLeft ? { scale: '-1 1' } : undefined}>
      <path d={greeting === 'push' ? 'M938 737Q1124 669 1289 735L1414 689' :
        'M931 792Q1100 839 1270 730Q1342 689 1384 719'} />
      <path d="M121 727Q182 791 353 822" />
    </svg>}
    <svg className="jujuba-expression" viewBox="0 0 1254 1254" aria-hidden="true">
      <defs>
        <linearGradient id={leftLid} x1="375" y1="524" x2="466" y2="704" gradientUnits="userSpaceOnUse">
          <stop stopColor="#bc0b82" />
          <stop offset=".52" stopColor="#ca128c" />
          <stop offset="1" stopColor="#d6198c" />
        </linearGradient>
        <linearGradient id={rightLid} x1="824" y1="554" x2="778" y2="696" gradientUnits="userSpaceOnUse">
          <stop stopColor="#b80778" />
          <stop offset=".55" stopColor="#cf0e87" />
          <stop offset="1" stopColor="#d91489" />
        </linearGradient>
        <clipPath id={mouth}><path d={smile} /></clipPath>
        {(followPointer || watching) && <>
          <clipPath id={leftPupil}><ellipse cx="435" cy="615" rx="82" ry="88" /></clipPath>
          <clipPath id={rightPupil}><path d="M717 614 843 584C865 646 827 694 784 694 743 694 717 659 717 614Z" /></clipPath>
        </>}
        {(protesting || scared || relieved || kissing) && <linearGradient id={cheek} x1="0" y1="660" x2="0" y2="750" gradientUnits="userSpaceOnUse">
          <stop stopColor="#cc158b" />
          <stop offset=".47" stopColor="#d8188c" />
          <stop offset="1" stopColor="#d31487" />
        </linearGradient>}
      </defs>
      {(followPointer || watching) && <g className={'jujuba-gaze' + (watching ? ' jujuba-pair-gaze' : '')}>
        <g clipPath={`url(#${leftPupil})`}>
          <rect x="339" y="521" width="194" height="190" fill="#510232" />
          <g className="jujuba-glints" fill="#fff7fc">
            <ellipse cx="427" cy="581" rx="40" ry="35" transform="rotate(-24 427 581)" />
            <circle cx="480" cy="625" r="15" />
          </g>
        </g>
        <g clipPath={`url(#${rightPupil})`}>
          <rect x="704" y="573" width="161" height="126" fill="#500132" />
          <g className="jujuba-glints" fill="#fff7fc">
            <ellipse cx="780" cy="603" rx="29" ry="29" />
            <circle cx="822" cy="640" r="11" />
          </g>
        </g>
      </g>}
      <g className="jujuba-eyelid jujuba-eyelid-left">
        <path fill={`url(#${leftLid})`} d="M350 612C350 563 387 522 434 522S520 564 520 613 482 706 434 706 350 663 350 612Z" />
        <path className="jujuba-closed-eye" d={protesting ? 'M373 603L488 633 395 650' : 'M365 607Q431 660 504 604'} />
      </g>
      <g className="jujuba-eyelid jujuba-eyelid-right">
        <path fill={`url(#${rightLid})`} d="M700 603 848 556Q867 551 867 570L853 611V626C853 666 826 697 784 697 740 697 712 661 711 622L704 616Q699 613 700 603Z" />
        <path className="jujuba-closed-eye" d={protesting ? 'M845 598L731 633 822 648' : 'M726 611Q782 657 843 594'} />
      </g>
      {scared && <g className="jujuba-scared-eyes">
        <ellipse cx="435" cy="610" rx="91" ry="96" fill="#fff3fa" stroke="#610033" strokeWidth="15" />
        <ellipse cx="784" cy="614" rx="91" ry="94" fill="#fff3fa" stroke="#610033" strokeWidth="15" />
        <circle cx="442" cy="615" r="28" fill="#4e052c" /><circle cx="778" cy="620" r="27" fill="#4e052c" />
        <path d="M354 500q85-65 156-7m195 0q74-61 152-8" fill="none" stroke="#670741" strokeWidth="22" strokeLinecap="round" />
      </g>}
      {(protesting || scared || relieved || kissing) && <g className="jujuba-mouth-reaction">
        <path fill={`url(#${cheek})`} d="M540 712C550 704 571 715 603 705 633 699 652 681 660 665 672 654 697 654 706 672 709 683 699 701 696 712 684 735 648 755 612 753 579 752 553 743 540 725Q536 719 540 712Z" />
        <ellipse cx="618" cy="709" rx={kissing ? 25 : relieved ? 35 : 39} ry={kissing ? 30 : relieved ? 19 : 43} fill="#520133" />
        {kissing && <path d="M601 710q17-13 34-1-15 21-34 1Z" fill="#ff8dbb" />}
        {!kissing && !relieved && <path d="M588 731Q616 704 648 730Q637 748 619 748 600 748 588 731Z" fill="#ef518f" />}
      </g>}
      <g className="jujuba-smile">
        <path d={smile} fill="#520133" />
        <g clipPath={`url(#${mouth})`}>
          <path d="M543 710C586 724 645 704 695 665C688 691 663 715 629 729C591 742 559 733 543 718Z" fill="#ffe1f2" />
          <path d="M572 760Q592 732 620 746Q638 728 665 755L658 780H581Z" fill="#ef518f" />
        </g>
      </g>
      {relieved && <g className="jujuba-wipe" fill="none" strokeLinecap="round">
        <path d="M984 780Q884 637 753 729L716 716" stroke="#ef569d" strokeWidth="62" />
        <path d="M662 712q47-26 74-11m-62 50q54-11 75 10" stroke="#ffe6f4" strokeWidth="18" />
      </g>}
    </svg>
  </span>
}
