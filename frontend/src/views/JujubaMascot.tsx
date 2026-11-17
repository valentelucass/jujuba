import { useEffect, useId, useRef } from 'react'
import jujuba from '../assets/jujuba.png'

export function JujubaMascot({ hero = false, followPointer = false, grabbed = false, protesting = false }: {
  hero?: boolean; followPointer?: boolean; grabbed?: boolean; protesting?: boolean
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

  return <span ref={mascot} className={'jujuba-mascot' + (hero ? ' jujuba-hero' : '')} aria-hidden="true">
    {grabbed && <svg className="jujuba-arms" viewBox="0 0 1254 1254" aria-hidden="true">
      <path className="jujuba-arm jujuba-arm-left" d="M235 685Q152 670 101 544L72 465" />
      <path className="jujuba-arm jujuba-arm-right" d="M1018 695Q1116 661 1151 539L1181 468" />
    </svg>}
    <img src={jujuba} alt="" draggable={false} />
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
        {followPointer && <>
          <clipPath id={leftPupil}><ellipse cx="435" cy="615" rx="82" ry="88" /></clipPath>
          <clipPath id={rightPupil}><path d="M717 614 843 584C865 646 827 694 784 694 743 694 717 659 717 614Z" /></clipPath>
        </>}
        {protesting && <linearGradient id={cheek} x1="0" y1="660" x2="0" y2="750" gradientUnits="userSpaceOnUse">
          <stop stopColor="#cc158b" />
          <stop offset=".47" stopColor="#d8188c" />
          <stop offset="1" stopColor="#d31487" />
        </linearGradient>}
      </defs>
      {followPointer && <g className="jujuba-gaze">
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
      {protesting && <g className="jujuba-protest">
        <path fill={`url(#${cheek})`} d="M540 712C550 704 571 715 603 705 633 699 652 681 660 665 672 654 697 654 706 672 709 683 699 701 696 712 684 735 648 755 612 753 579 752 553 743 540 725Q536 719 540 712Z" />
        <ellipse cx="618" cy="709" rx="39" ry="43" fill="#520133" />
        <path d="M588 731Q616 704 648 730Q637 748 619 748 600 748 588 731Z" fill="#ef518f" />
      </g>}
      <g className="jujuba-smile">
        <path d={smile} fill="#520133" />
        <g clipPath={`url(#${mouth})`}>
          <path d="M543 710C586 724 645 704 695 665C688 691 663 715 629 729C591 742 559 733 543 718Z" fill="#ffe1f2" />
          <path d="M572 760Q592 732 620 746Q638 728 665 755L658 780H581Z" fill="#ef518f" />
        </g>
      </g>
    </svg>
  </span>
}
